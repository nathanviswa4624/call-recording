/** System and network probes used by monitoring and trunk connectivity tests. */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import dns from 'node:dns/promises';
import net from 'node:net';
import dgram from 'node:dgram';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

export async function systemStats(recordingBase: string) {
  const load = os.loadavg();
  let disk: { totalBytes: number; freeBytes: number } | null = null;
  try {
    const s = await fs.statfs(recordingBase);
    disk = { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    disk = null;
  }
  return {
    hostname: os.hostname(),
    cpuCount: os.cpus().length,
    load1: load[0], load5: load[1], load15: load[2],
    cpuPercent: Math.min(100, Math.round(((load[0] ?? 0) / Math.max(1, os.cpus().length)) * 100)),
    memTotalBytes: os.totalmem(),
    memFreeBytes: os.freemem(),
    uptimeSec: os.uptime(),
    recordingDisk: disk,
  };
}

const HOST_RE = /^[A-Za-z0-9.\-:]{1,253}$/;

export interface NetCheck {
  host: string;
  port: number;
  proto: string;
  dns: string | null;
  dnsError?: string;
  reachable: boolean;
  rttMs?: number;
  reachError?: string;
  sipStatus?: string;
}

/**
 * DNS → transport reachability. For UDP and TCP an OPTIONS request is sent
 * and any SIP response counts as reachable (status line returned).
 */
export async function netCheck(host: string, port: number, proto: 'udp' | 'tcp' | 'tls'): Promise<NetCheck> {
  if (!HOST_RE.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid host/port');
  const out: NetCheck = { host, port, proto, dns: null, reachable: false };
  try {
    out.dns = net.isIP(host) ? host : (await dns.lookup(host)).address;
  } catch (e) {
    out.dnsError = (e as Error).message;
    return out;
  }
  const started = Date.now();
  const options = buildOptions(out.dns, port, proto);
  try {
    const status = proto === 'udp' ? await udpProbe(out.dns, port, options) : await streamProbe(out.dns, port, proto, options);
    out.reachable = true;
    out.sipStatus = status ?? undefined;
    out.rttMs = Date.now() - started;
  } catch (e) {
    out.reachError = (e as Error).message;
  }
  return out;
}

function buildOptions(ip: string, port: number, proto: string): string {
  const branch = `z9hG4bK${randomBytes(6).toString('hex')}`;
  const tag = randomBytes(4).toString('hex');
  const callId = `${randomBytes(8).toString('hex')}@echelons-probe`;
  const t = proto.toUpperCase();
  const host = ip.includes(':') ? `[${ip}]` : ip;
  return [
    `OPTIONS sip:${host}:${port} SIP/2.0`,
    `Via: SIP/2.0/${t} 0.0.0.0:5060;branch=${branch};rport`,
    'Max-Forwards: 70',
    `From: <sip:probe@echelons.invalid>;tag=${tag}`,
    `To: <sip:${host}:${port}>`,
    `Call-ID: ${callId}`,
    'CSeq: 1 OPTIONS',
    'User-Agent: Echelons-Connectivity-Probe',
    'Content-Length: 0',
    '', '',
  ].join('\r\n');
}

function udpProbe(ip: string, port: number, payload: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket(net.isIPv6(ip) ? 'udp6' : 'udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error('no SIP response within 3s (UDP)')); }, 3000);
    sock.on('message', (msg) => {
      clearTimeout(timer);
      sock.close();
      resolve(msg.toString('utf8').split('\r\n')[0] ?? null);
    });
    sock.on('error', (e) => { clearTimeout(timer); sock.close(); reject(e); });
    sock.send(payload, port, ip);
  });
}

function streamProbe(ip: string, port: number, proto: 'tcp' | 'tls', payload: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const sock = proto === 'tls'
      ? tls.connect({ host: ip, port, rejectUnauthorized: false, servername: net.isIP(ip) ? undefined : ip })
      : net.connect({ host: ip, port });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`connect timeout (${proto.toUpperCase()})`)); }, 4000);
    sock.once(proto === 'tls' ? 'secureConnect' : 'connect', () => sock.write(payload));
    let data = '';
    sock.on('data', (d) => {
      data += d.toString('utf8');
      if (data.includes('\r\n')) {
        clearTimeout(timer);
        sock.destroy();
        resolve(data.split('\r\n')[0] ?? null);
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    // Connected but silent: transport reachable, SIP not answering.
    sock.on('close', () => { clearTimeout(timer); if (!data) resolve(null); });
  });
}

export function parseVersion(raw: string): { raw: string; major: number; minor: number; patch: number } | null {
  const m = /Asterisk (?:certified[-/])?(\d+)\.(\d+)\.?(\d+)?/i.exec(raw);
  if (!m) return null;
  return { raw: raw.trim().split('\n')[0]!.slice(0, 120), major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) };
}
