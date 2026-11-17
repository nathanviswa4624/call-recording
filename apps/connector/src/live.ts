/**
 * Live call model built from AMI events (spec §25, §51). Emits normalised
 * events consumed by the backend over the connector's SSE stream.
 */
import { EventEmitter } from 'node:events';
import type { AmiMessage } from './ami/protocol.js';

export interface LiveChannel {
  uniqueid: string;
  linkedid: string;
  channel: string;
  callerNumber: string;
  callerName: string;
  exten: string;
  context: string;
  state: string;
  startedAt: number;
  vars: Record<string, string>;
  recording: boolean;
}

export interface LiveCall {
  linkedid: string;
  caller: string;
  destination: string;
  pbxCode: string | null;
  pbxId: string | null;
  routeId: string | null;
  direction: string | null;
  startedAt: number;
  channels: number;
  recording: 'ACTIVE' | 'NONE' | 'COMPLETE';
  answered: boolean;
}

const TRACKED_VARS = new Set(['ECH_PBX_ID', 'ECH_PBX_CODE', 'ECH_ROUTE_ID', 'ECH_DIRECTION', 'ECH_REC_FILE', 'ECH_TRUNK_ID', 'ECH_NUM']);

export class LiveCalls extends EventEmitter {
  private channels = new Map<string, LiveChannel>();

  reset() {
    this.channels.clear();
    this.emit('reset');
  }

  snapshot(): LiveCall[] {
    const byLinked = new Map<string, LiveChannel[]>();
    for (const c of this.channels.values()) {
      const list = byLinked.get(c.linkedid) ?? [];
      list.push(c);
      byLinked.set(c.linkedid, list);
    }
    return [...byLinked.entries()].map(([linkedid, list]) => this.toCall(linkedid, list));
  }

  private toCall(linkedid: string, list: LiveChannel[]): LiveCall {
    const first = list.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));
    const v = (k: string) => list.map((c) => c.vars[k]).find(Boolean) ?? null;
    return {
      linkedid,
      caller: first.callerNumber,
      destination: v('ECH_NUM') ?? first.exten,
      pbxCode: v('ECH_PBX_CODE'),
      pbxId: v('ECH_PBX_ID'),
      routeId: v('ECH_ROUTE_ID'),
      direction: v('ECH_DIRECTION'),
      startedAt: first.startedAt,
      channels: list.length,
      recording: list.some((c) => c.recording) ? 'ACTIVE' : 'NONE',
      answered: list.some((c) => c.state === 'Up'),
    };
  }

  private callFor(linkedid: string): LiveCall | null {
    const list = [...this.channels.values()].filter((c) => c.linkedid === linkedid);
    return list.length ? this.toCall(linkedid, list) : null;
  }

  handle(e: AmiMessage) {
    const ev = e['Event'];
    const uid = e['Uniqueid'];
    switch (ev) {
      case 'Newchannel': {
        if (!uid) return;
        const isNewCall = ![...this.channels.values()].some((c) => c.linkedid === e['Linkedid']);
        this.channels.set(uid, {
          uniqueid: uid, linkedid: e['Linkedid'] ?? uid, channel: e['Channel'] ?? '', callerNumber: e['CallerIDNum'] ?? '',
          callerName: e['CallerIDName'] ?? '', exten: e['Exten'] ?? '', context: e['Context'] ?? '', state: e['ChannelStateDesc'] ?? '',
          startedAt: Date.now(), vars: {}, recording: false,
        });
        if (isNewCall) this.emit('call', 'call.started', this.callFor(e['Linkedid'] ?? uid));
        break;
      }
      case 'Newstate':
      case 'NewCallerid':
      case 'NewConnectedLine': {
        const c = uid ? this.channels.get(uid) : undefined;
        if (!c) return;
        if (e['ChannelStateDesc']) c.state = e['ChannelStateDesc'];
        if (e['CallerIDNum'] && ev !== 'NewConnectedLine') c.callerNumber = e['CallerIDNum'];
        this.emit('call', 'call.updated', this.callFor(c.linkedid));
        break;
      }
      case 'VarSet': {
        const c = uid ? this.channels.get(uid) : undefined;
        const name = (e['Variable'] ?? '').replace(/^_+/, '');
        if (!c || !TRACKED_VARS.has(name)) return;
        c.vars[name] = e['Value'] ?? '';
        this.emit('call', 'call.updated', this.callFor(c.linkedid));
        break;
      }
      case 'MixMonitorStart':
      case 'MixMonitorStop': {
        const c = uid ? this.channels.get(uid) : undefined;
        if (!c) return;
        c.recording = ev === 'MixMonitorStart';
        this.emit('call', ev === 'MixMonitorStart' ? 'recording.started' : 'recording.stopped', { ...this.callFor(c.linkedid), file: c.vars['ECH_REC_FILE'] ?? null });
        break;
      }
      case 'Hangup': {
        const c = uid ? this.channels.get(uid) : undefined;
        if (!c) return;
        this.channels.delete(uid!);
        const remaining = this.callFor(c.linkedid);
        if (!remaining) {
          this.emit('call', 'call.ended', {
            linkedid: c.linkedid, caller: c.callerNumber, destination: c.vars['ECH_NUM'] ?? c.exten,
            cause: e['Cause'], causeTxt: e['Cause-txt'], recording: c.recording || c.vars['ECH_REC_FILE'] ? 'COMPLETE' : 'NONE',
          });
        } else this.emit('call', 'call.updated', remaining);
        break;
      }
      case 'ContactStatus':
        this.emit('call', 'endpoint.status', { aor: e['AOR'], uri: e['URI'], status: e['ContactStatus'], rttUsec: e['RoundtripUsec'], endpoint: e['EndpointName'] });
        break;
      case 'Registry':
        this.emit('call', 'registration.status', { domain: e['Domain'], username: e['Username'], status: e['Status'], cause: e['Cause'] });
        break;
      default:
        break;
    }
  }
}
