import { Router } from 'express';
import { prisma } from '../db/client.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const homepageRouter = Router();

// Public read (header title / hero slides are rendered for anonymous visitors).
homepageRouter.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const key = req.params.key as string;
    const row = await prisma.homepageSetting.findUnique({ where: { key } });
    if (!row) {
      res.json(null);
      return;
    }
    res.json({ key: row.key, value: row.value });
  }),
);

homepageRouter.patch(
  '/:key',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const key = req.params.key as string;
    const value = (req.body as { value: unknown }).value;
    const row = await prisma.homepageSetting.upsert({
      where: { key },
      create: { key, value: value as object },
      update: { value: value as object, updatedAt: new Date() },
    });
    res.json({ key: row.key, value: row.value });
  }),
);
