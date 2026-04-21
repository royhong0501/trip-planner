import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { homepageSettings } from '../db/schema/index.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const homepageRouter = Router();

// Public read (header title / hero slides are rendered for anonymous visitors).
homepageRouter.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const key = req.params.key as string;
    const [row] = await db
      .select()
      .from(homepageSettings)
      .where(eq(homepageSettings.key, key))
      .limit(1);
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
    const [row] = await db
      .insert(homepageSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: homepageSettings.key,
        set: { value, updatedAt: new Date() },
      })
      .returning();
    res.json({ key: row!.key, value: row!.value });
  }),
);
