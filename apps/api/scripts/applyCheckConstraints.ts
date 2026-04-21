/**
 * Applies `prisma/sql/check_constraints.sql` via the Prisma client.
 * Idempotent — each statement does DROP IF EXISTS before ADD.
 *
 * Run after `prisma migrate deploy`:
 *   npm run db:migrate     (runs prisma migrate deploy && this script)
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { prisma } from '../src/db/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SQL_PATH = resolve(__dirname, '../prisma/sql/check_constraints.sql');

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));
}

async function main(): Promise<void> {
  const sql = readFileSync(SQL_PATH, 'utf8');
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }
  console.log(`[applyCheckConstraints] applied ${statements.length} statement(s)`);
}

main()
  .catch((err) => {
    console.error('[applyCheckConstraints] failed', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
