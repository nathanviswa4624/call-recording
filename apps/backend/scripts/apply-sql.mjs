// Applies prisma/sql/*.sql in name order (each file must be idempotent).
// Uses pg's simple-query protocol, which allows multi-statement files and DO blocks.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'sql');
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('schema'); // Prisma-specific parameter
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    await client.query(await readFile(path.join(dir, f), 'utf8'));
    console.log(`applied ${f}`);
  }
} finally {
  await client.end();
}
