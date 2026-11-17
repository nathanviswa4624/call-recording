/**
 * Managed Asterisk config files. Only two file names may ever be written; writes
 * are atomic (tmp + fsync + rename) and keep one .bak for rollback.
 */
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MANAGED_FILES = new Set(['extensions_echelons.conf', 'pjsip_echelons_transports.conf']);

export class ManagedFiles {
  constructor(private readonly dir: string) {}

  private resolve(name: string): string {
    if (!MANAGED_FILES.has(name)) throw new Error(`"${name}" is not a managed file`);
    return path.join(this.dir, name);
  }

  async read(name: string): Promise<string | null> {
    try {
      return await fs.readFile(this.resolve(name), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async write(name: string, content: string): Promise<{ sha256: string; backup: string | null }> {
    if (content.length > 5 * 1024 * 1024) throw new Error('config file too large');
    if (content.includes('\0')) throw new Error('config file contains NUL bytes');
    // A managed file must not pull in other files or run shell commands.
    if (/^\s*#(include|exec|tryinclude)\b/m.test(content)) throw new Error('#include/#exec are not allowed in managed files');
    const target = this.resolve(name);
    const bak = `${target}.bak`;
    let backup: string | null = null;
    try {
      await fs.access(target, constants.F_OK);
      await fs.copyFile(target, bak);
      backup = bak;
    } catch {
      /* first write: nothing to back up */
    }
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    const fh = await fs.open(tmp, 'w', 0o640);
    try {
      await fh.writeFile(content, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, target);
    return { sha256: createHash('sha256').update(content).digest('hex'), backup };
  }

  async restore(name: string): Promise<boolean> {
    const target = this.resolve(name);
    try {
      await fs.copyFile(`${target}.bak`, `${target}.tmp-restore`);
      await fs.rename(`${target}.tmp-restore`, target);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        // No backup means the file did not exist before: remove it to restore that state.
        await fs.rm(target, { force: true });
        return true;
      }
      throw e;
    }
  }
}

/** Confine a relative recording path to the recording base directory. */
export async function confineRecording(base: string, rel: string): Promise<string> {
  if (!rel || rel.includes('\0') || path.isAbsolute(rel) || /(^|[\\/])\.\.([\\/]|$)/.test(rel)) throw new Error('invalid recording path');
  const root = await fs.realpath(base);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error('invalid recording path');
  try {
    const real = await fs.realpath(full);
    if (!real.startsWith(root + path.sep)) throw new Error('invalid recording path');
    return real;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return full;
    throw e;
  }
}
