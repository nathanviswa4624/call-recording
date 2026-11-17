/**
 * Idempotent seed: permissions, built-in roles, vendor trunk templates.
 * Organisation-scoped data (call types, default recording policy) is created
 * by the first-run setup wizard via seedOrganization().
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { ALL_PERMISSIONS, BUILTIN_CALL_TYPES, BUILTIN_ROLES, VENDOR_TEMPLATES } from '@echelons/shared';

const prisma = new PrismaClient();

const CALL_TYPE_COLORS: Record<string, string> = {
  INTERNAL: '#64748b', EXTERNAL: '#0ea5e9', INBOUND: '#2563eb', OUTBOUND: '#7c3aed', INTERNATIONAL: '#db2777',
  LOCAL: '#0891b2', MOBILE: '#16a34a', NATIONAL: '#0d9488', EMERGENCY: '#dc2626', TRANSFER: '#a16207',
  CONFERENCE: '#9333ea', QUEUE: '#ca8a04', IVR: '#4f46e5', MISSED: '#ea580c', ABANDONED: '#f97316',
  FAILED: '#b91c1c', BUSY: '#d97706', NO_ANSWER: '#78716c',
};

export async function seedGlobal(db: PrismaClient | Prisma.TransactionClient = prisma) {
  for (const code of ALL_PERMISSIONS) {
    await db.permission.upsert({ where: { code }, update: {}, create: { code } });
  }
  const perms = new Map((await db.permission.findMany()).map((p) => [p.code, p.id]));
  for (const [code, def] of Object.entries(BUILTIN_ROLES)) {
    const existing = await db.role.findFirst({ where: { organizationId: null, code } });
    const role = existing ?? (await db.role.create({ data: { code, name: def.name, description: def.description, builtin: true } }));
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({ data: def.permissions.map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })) });
  }
  for (const t of VENDOR_TEMPLATES) {
    const existing = await db.trunkTemplate.findFirst({ where: { organizationId: null, code: t.code } });
    if (!existing) {
      await db.trunkTemplate.create({
        data: { code: t.code, vendor: t.vendor, name: t.name, description: t.description, defaultProtocol: t.defaultProtocol, defaultPort: t.defaultPort, defaults: t.defaults as Prisma.InputJsonValue, builtin: true },
      });
    }
  }
}

export async function seedOrganization(db: PrismaClient | Prisma.TransactionClient, organizationId: string) {
  for (const code of BUILTIN_CALL_TYPES) {
    await db.callType.upsert({
      where: { organizationId_code: { organizationId, code } },
      update: {},
      create: { organizationId, code, name: code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()), color: CALL_TYPE_COLORS[code], builtin: true },
    });
  }
  // Composite types used by the default classification examples.
  for (const [code, name] of [['OUTBOUND_MOBILE', 'Outbound Mobile'], ['INBOUND_EXTERNAL', 'Inbound External']] as const) {
    await db.callType.upsert({ where: { organizationId_code: { organizationId, code } }, update: {}, create: { organizationId, code, name } });
  }
  const hasDefault = await db.recordingPolicy.findFirst({ where: { organizationId, isDefault: true } });
  if (!hasDefault) {
    await db.recordingPolicy.create({ data: { organizationId, name: 'Record all calls', mode: 'ALWAYS', layout: 'MIXED', format: 'wav', isDefault: true } });
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seedGlobal()
    .then(() => console.log('seed complete'))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
