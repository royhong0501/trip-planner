import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * Shared Prisma client. In dev we cache it on `globalThis` so `tsx watch`
 * hot-reloads don't leak connections; in prod we always construct fresh.
 *
 * For interactive transactions (including SELECT ... FOR UPDATE patterns),
 * call `prisma.$transaction(async (tx) => { ... })` directly — the `tx`
 * argument has the same type as `prisma` minus the nested $transaction method.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: ['warn', 'error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type Prisma = typeof prisma;
