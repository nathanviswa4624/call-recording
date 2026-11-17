import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../config/env.js';

export interface AccessClaims {
  sub: string;
  org: string;
  /** Permission codes. */
  perms: string[];
  /** Site restriction; empty = all sites in org. */
  sites: string[];
  pv: number;
  name: string;
}

const ISSUER = 'echelons';
const AUDIENCE = 'echelons-api';

function key(): Uint8Array {
  return new TextEncoder().encode(env().JWT_SECRET);
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  const { sub, ...rest } = claims;
  return new SignJWT({ ...rest })
    .setProtectedHeader({ alg: 'HS512' })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env().JWT_ACCESS_TTL)
    .sign(key());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS512'] });
  if (typeof payload.sub !== 'string' || typeof payload['org'] !== 'string') throw new Error('malformed token');
  return {
    sub: payload.sub,
    org: payload['org'] as string,
    perms: Array.isArray(payload['perms']) ? (payload['perms'] as string[]) : [],
    sites: Array.isArray(payload['sites']) ? (payload['sites'] as string[]) : [],
    pv: Number(payload['pv'] ?? 0),
    name: String(payload['name'] ?? ''),
  };
}
