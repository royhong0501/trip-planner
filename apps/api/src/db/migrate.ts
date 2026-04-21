import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

const thisFile = fileURLToPath(import.meta.url);
const migrationsFolder = path.resolve(path.dirname(thisFile), '../../../../db/migrations');

async function main() {
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('[migrate] done');
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] failed', err);
  pool.end().finally(() => process.exit(1));
});
