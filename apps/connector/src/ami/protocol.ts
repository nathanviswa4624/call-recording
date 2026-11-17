/**
 * AMI wire protocol helpers: message framing, parsing and serialisation.
 * Messages are CRLF-separated "Key: Value" lines terminated by an empty line.
 */

export type AmiMessage = Record<string, string>;

/** Incremental parser: feed raw socket chunks, get complete messages. */
export class AmiParser {
  private buffer = '';
  private greeted = false;
  banner: string | null = null;

  push(chunk: string): AmiMessage[] {
    this.buffer += chunk;
    const out: AmiMessage[] = [];
    if (!this.greeted) {
      const nl = this.buffer.indexOf('\r\n');
      if (nl === -1) return out;
      this.banner = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 2);
      this.greeted = true;
    }
    let idx: number;
    while ((idx = this.buffer.indexOf('\r\n\r\n')) !== -1) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 4);
      if (block.trim()) out.push(parseBlock(block));
    }
    if (this.buffer.length > 8 * 1024 * 1024) throw new Error('AMI message exceeds 8MB without terminator');
    return out;
  }
}

/**
 * Parse one message block. Repeated keys (e.g. "Output:" lines from the
 * Command action) are joined with newlines.
 */
export function parseBlock(block: string): AmiMessage {
  const msg: AmiMessage = {};
  for (const line of block.split('\r\n')) {
    const i = line.indexOf(':');
    if (i <= 0) {
      // Legacy (pre-14) Command output arrives as raw lines.
      if (line.length) msg['Output'] = msg['Output'] !== undefined ? `${msg['Output']}\n${line}` : line;
      continue;
    }
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).replace(/^ /, '');
    msg[key] = msg[key] !== undefined ? `${msg[key]}\n${value}` : value;
  }
  return msg;
}

/** Serialise an action; rejects CR/LF in keys or values (header injection). */
export function serializeAction(action: string, actionId: string, params: Record<string, string | number | undefined>): string {
  const lines = [`Action: ${action}`, `ActionID: ${actionId}`];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const value = String(v);
    if (/[\r\n]/.test(k) || /[\r\n]/.test(value) || !/^[A-Za-z0-9_-]+$/.test(k)) throw new Error(`invalid AMI parameter ${k}`);
    lines.push(`${k}: ${value}`);
  }
  if (!/^[A-Za-z0-9]+$/.test(action)) throw new Error('invalid AMI action');
  return `${lines.join('\r\n')}\r\n\r\n`;
}
