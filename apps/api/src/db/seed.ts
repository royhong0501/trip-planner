import 'dotenv/config';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db, pool } from './client.js';
import { adminUsers } from './schema/index.js';

async function main() {
  const email = env.ADMIN_SEED_EMAIL;
  const password = env.ADMIN_SEED_PASSWORD;

  if (!email || !password) {
    console.log('[seed] ADMIN_SEED_EMAIL or ADMIN_SEED_PASSWORD not set; skipping admin seed.');
    return;
  }

  const existing = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  if (existing.length > 0) {
    console.log(`[seed] admin ${email} already exists; no changes made.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(adminUsers)
    .values({ email, passwordHash })
    .returning({ id: adminUsers.id, email: adminUsers.email });
  console.log(`[seed] created admin ${user?.email ?? email} (id=${user?.id ?? '??'})`);
}

main()
  .catch((err) => {
    console.error('[seed] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
