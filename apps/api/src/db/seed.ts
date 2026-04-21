import 'dotenv/config';
import bcrypt from 'bcrypt';
import { env } from '../config/env.js';
import { prisma } from './client.js';

async function main() {
  const email = env.ADMIN_SEED_EMAIL;
  const password = env.ADMIN_SEED_PASSWORD;

  if (!email || !password) {
    console.log('[seed] ADMIN_SEED_EMAIL or ADMIN_SEED_PASSWORD not set; skipping admin seed.');
    return;
  }

  const existing = await prisma.adminUser.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    console.log(`[seed] admin ${email} already exists; no changes made.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.adminUser.create({
    data: { email, passwordHash },
    select: { id: true, email: true },
  });
  console.log(`[seed] created admin ${user.email} (id=${user.id})`);
}

main()
  .catch((err) => {
    console.error('[seed] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
