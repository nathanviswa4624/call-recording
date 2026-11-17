import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { attachRealtime } from './modules/realtime/hub.js';
import { startLiveBridge } from './modules/realtime/bridge.js';

// BigInt values (CDR seq, sizes) are serialised as numbers-as-strings safely.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};

async function main() {
  const e = env();
  const app = await buildApp();
  attachRealtime(app);
  const stopBridge = startLiveBridge(app.log);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopBridge();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: e.BACKEND_HOST, port: e.BACKEND_PORT });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
