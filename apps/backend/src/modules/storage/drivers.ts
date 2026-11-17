/**
 * Storage drivers (docs/07 §4). Files are always streamed; nothing is
 * buffered in memory. Local/NFS/NAS paths are confined to their base path.
 */
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageLocation } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { SecretBox } from '../../lib/crypto.js';
import { env } from '../../config/env.js';

export interface ByteRange { start: number; end: number }
export interface StatResult { exists: boolean; size: number; mtime: Date | null }

export interface StorageDriver {
  stat(rel: string): Promise<StatResult>;
  read(rel: string, range?: ByteRange): Promise<Readable>;
  delete(rel: string): Promise<void>;
  presign?(rel: string, seconds: number, filename: string): Promise<string>;
  usage?(): Promise<{ totalBytes: number; freeBytes: number }>;
}

/** Resolve a relative recording path inside base, rejecting traversal and absolute paths. */
export function confine(base: string, rel: string): string {
  if (!rel || rel.includes('\0') || path.isAbsolute(rel) || /(^|[\\/])\.\.([\\/]|$)/.test(rel)) {
    throw new AppError('VALIDATION_FAILED', 'invalid recording path');
  }
  const root = path.resolve(base);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new AppError('VALIDATION_FAILED', 'invalid recording path');
  return full;
}

export class LocalDriver implements StorageDriver {
  constructor(private readonly base: string) {}

  async stat(rel: string): Promise<StatResult> {
    const full = confine(this.base, rel);
    try {
      // Resolve symlinks and re-check confinement.
      const real = await fs.realpath(full);
      const realBase = await fs.realpath(this.base);
      if (!real.startsWith(realBase + path.sep)) return { exists: false, size: 0, mtime: null };
      const s = await fs.stat(real);
      return { exists: s.isFile(), size: s.size, mtime: s.mtime };
    } catch {
      return { exists: false, size: 0, mtime: null };
    }
  }

  async read(rel: string, range?: ByteRange): Promise<Readable> {
    return createReadStream(confine(this.base, rel), range ? { start: range.start, end: range.end } : undefined);
  }

  async delete(rel: string): Promise<void> {
    await fs.unlink(confine(this.base, rel));
  }

  async usage() {
    const s = await fs.statfs(this.base);
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  }
}

export class S3Driver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(loc: StorageLocation) {
    const box = new SecretBox(env().ENCRYPTION_KEY);
    const [bucket, ...prefix] = loc.basePath.split('/');
    this.bucket = bucket!;
    this.prefix = prefix.join('/');
    this.client = new S3Client({
      endpoint: loc.endpoint ?? undefined,
      region: loc.region ?? 'us-east-1',
      forcePathStyle: loc.forcePathStyle,
      credentials: loc.accessKeyEnc && loc.secretKeyEnc
        ? { accessKeyId: box.decrypt(loc.accessKeyEnc, `storage:${loc.id}:ak`), secretAccessKey: box.decrypt(loc.secretKeyEnc, `storage:${loc.id}:sk`) }
        : undefined,
    });
  }

  private key(rel: string) {
    confine('/x', rel); // same traversal rules
    return this.prefix ? `${this.prefix}/${rel}` : rel;
  }

  async stat(rel: string): Promise<StatResult> {
    try {
      const h = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(rel) }));
      return { exists: true, size: Number(h.ContentLength ?? 0), mtime: h.LastModified ?? null };
    } catch {
      return { exists: false, size: 0, mtime: null };
    }
  }

  async read(rel: string, range?: ByteRange): Promise<Readable> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(rel), Range: range ? `bytes=${range.start}-${range.end}` : undefined }));
    return r.Body as Readable;
  }

  async delete(rel: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(rel) }));
  }

  presign(rel: string, seconds: number, filename: string) {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket, Key: this.key(rel),
      ResponseContentDisposition: `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    }), { expiresIn: Math.min(seconds, 300) });
  }
}

export function driverFor(loc: StorageLocation): StorageDriver {
  switch (loc.kind) {
    case 'S3': return new S3Driver(loc);
    default: return new LocalDriver(loc.basePath);
  }
}

/** Parse a single HTTP Range header ("bytes=a-b"). Multi-range is not supported (returns null → full). */
export function parseRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start: number;
  let end: number;
  if (m[1] === '' && m[2] === '') return null;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}
