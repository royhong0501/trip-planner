import { Router } from 'express';
import type { AdminUser } from '@trip-planner/shared-types';
import {
  createAdminUserSchema,
  updateAdminUserPasswordSchema,
} from '@trip-planner/shared-schema';
import { prisma } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { hashPassword } from '../services/auth.js';
import { HttpError } from '../utils/httpError.js';

export const adminUsersRouter = Router();

adminUsersRouter.use(requireAdmin);

type PrismaAdminUserRecord = {
  id: string;
  email: string;
  createdAt: Date;
};

function toDto(row: PrismaAdminUserRecord): AdminUser {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  };
}

adminUsersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
    });
    res.json(rows.map(toDto));
  }),
);

adminUsersRouter.post(
  '/',
  validate(createAdminUserSchema, 'body'),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const normalized = email.trim().toLowerCase();
    const existing = await prisma.adminUser.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (existing) throw HttpError.conflict('此 Email 已被使用');

    const passwordHash = await hashPassword(password);
    const row = await prisma.adminUser.create({
      data: { email: normalized, passwordHash },
    });
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
    try {
      const row = await prisma.adminUser.update({
        where: { id: userId },
        data: { passwordHash, updatedAt: new Date() },
      });
      res.json(toDto(row));
    } catch (err) {
      if (isNotFoundError(err)) throw HttpError.notFound('使用者不存在');
      throw err;
    }
  }),
);

adminUsersRouter.delete(
  '/:userId',
  asyncHandler(async (req, res) => {
    const userId = req.params.userId as string;
    if (req.admin?.sub === userId) {
      throw HttpError.badRequest('無法刪除自己的帳號');
    }
    try {
      await prisma.adminUser.delete({ where: { id: userId }, select: { id: true } });
      res.status(204).end();
    } catch (err) {
      if (isNotFoundError(err)) throw HttpError.notFound('使用者不存在');
      throw err;
    }
  }),
);

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2025'
  );
}
