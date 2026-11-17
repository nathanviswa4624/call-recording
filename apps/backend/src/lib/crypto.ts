/**
 * AES-256-GCM secret encryption for values stored at rest (SIP passwords,
 * S3 keys, connector tokens, TOTP seeds). Format: v1:<iv b64>:<tag b64>:<ct b64>
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('encryption key must be 32 bytes');
  }

  encrypt(plaintext: string, aad = ''): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
  }

  decrypt(payload: string, aad = ''): string {
    const [ver, ivB64, tagB64, ctB64] = payload.split(':');
    if (ver !== VERSION || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error('unsupported secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  }
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Stable JSON stringify (sorted keys) used for draft/published hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function hashObject(value: unknown): string {
  return sha256(stableStringify(value));
}

/**
 * Deterministic keyed fingerprint of a secret, used only to detect changes
 * (draft vs published) without storing anything reversible.
 */
export function secretFingerprint(secret: string): string {
  const key = process.env.ENCRYPTION_KEY ?? '';
  return createHmac('sha256', Buffer.from(key, 'base64')).update(`fp:${secret}`).digest('hex');
}
