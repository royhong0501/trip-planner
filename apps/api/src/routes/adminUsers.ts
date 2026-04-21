import { Router } from 'express';
import { asc, eq } from 'drizzle-orm';
import type { AdminUser } from '@trip-planner/shared-types';
import {
  createAdminUserSchema,
  updateAdminUserPasswordSchema,
} from '@trip-planner/shared-schema';
import { db } from '../db/client.js';
import { adminUsers } from '../db/schema/index.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { hashPassword } from '../services/auth.js';
import { HttpError } from '../utils/httpError.js';

export const adminUsersRouter = Router();

adminUsersRouter.use(requireAdmin);

function toDto(row: typeof adminUsers.$inferSelect): AdminUser {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  };
}

adminUsersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(adminUsers).orderBy(asc(adminUsers.createdAt));
    res.json(rows.map(toDto));
  }),
);

adminUsersRouter.post(
  '/',
  validate(createAdminUserSchema, 'body'),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const normalized = email.trim().toLowerCase();
    const existing = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, normalized))
      .limit(1);
    if (existing.length > 0) throw HttpError.conflict('此 Email 已被使用');

    const passwordHash = await hashPassword(password);
    const [row] = await db
      .insert(adminUsers)
      .values({ email: normalized, passwordHash })
      .returning();
    if (!row) throw new Error('Failed to insert admin user');
    res.status(201).json(toDto(row));
  }),
);

adminUsersRouter.patch(
  '/:userId/password',
  validate(
    // The path param supplies userId; the body only needs `password`.
    updateAdminUserPasswordSchema.pick({ password: true }).extend({
      password: updateAdminUserPasswordSchema.shape.password,
    }),
    'body',
  ),
  asyncHandler(async (req, res) => {
    const userId = req.params.userId as string;
    const { password } = req.body as { password: string };
    const passwordHash = await hashPassword(password);
    const [row] = await db
      .update(adminUsers)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(adminUsers.id, userId))
      .returning();
    if (!row) throw HttpError.notFound('使用者不存在');
    res.json(toDto(row));
  }),
);

adminUsersRouter.delete(
  '/:userId',
  asyncHandler(async (req, res) => {
    const userId = req.params.userId as string;
    if (req.admin?.sub === userId) {
      throw HttpError.badRequest('無法刪除自己的帳號');
    }
    const deleted = await db
      .delete(adminUsers)
      .where(eq(adminUsers.id, userId))
      .returning({ id: adminUsers.id });
    if (deleted.length === 0) throw HttpError.notFound('使用者不存在');
    res.status(204).end();
  }),
);
