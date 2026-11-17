/**
 * Short-lived signed media tokens for <audio> playback and downloads.
 *
 * Browsers cannot attach an Authorization header to media element requests,
 * and putting the JWT in a URL would leak a full session credential into logs.
 * Instead the API issues a token bound to (user, recording, channel, purpose)
 * that expires in minutes. The stream endpoint re-loads the user's current
 * permissions and re-runs the recording access check on every request.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type MediaPurpose = 'stream' | 'download';

export interface MediaTokenPayload {
  uid: string;
  rid: string;
  ch: string;
  p: MediaPurpose;
  exp: number; // unix seconds
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function key(secret: string) {
  // Domain-separated from the JWT signing key.
  return createHmac('sha256', secret).update('echelons-media-token-v1').digest();
}

export function signMediaToken(payload: MediaTokenPayload, secret: string): string {
  const body = b64(JSON.stringify(payload));
  const sig = b64(createHmac('sha256', key(secret)).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyMediaToken(token: string, secret: string, now = Date.now()): MediaTokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig || token.length > 1024) return null;
  const expected = createHmac('sha256', key(secret)).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as MediaTokenPayload;
    if (typeof p.uid !== 'string' || typeof p.rid !== 'string' || typeof p.exp !== 'number') return null;
    if (p.p !== 'stream' && p.p !== 'download') return null;
    if (p.exp * 1000 < now) return null;
    return p;
  } catch {
    return null;
  }
}
