import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
});

export type Tx = Prisma.TransactionClient;

/**
 * Run `fn` in a transaction with the Postgres RLS tenant variable set
 * (docs/02 §1). Every tenant-scoped write path should go through this.
 */
export async function withTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${organizationId}, true)`;
      return fn(tx);
    },
    { timeout: opts?.timeout ?? 15_000 },
  );
}
