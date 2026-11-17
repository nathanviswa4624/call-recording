// next "standalone" output does not include static assets; copy them next to server.js.
import { cpSync, existsSync } from 'node:fs';
const target = '.next/standalone/apps/web';
if (existsSync(target)) {
  cpSync('.next/static', `${target}/.next/static`, { recursive: true });
  if (existsSync('public')) cpSync('public', `${target}/public`, { recursive: true });
  console.log('copied static assets into standalone output');
}
