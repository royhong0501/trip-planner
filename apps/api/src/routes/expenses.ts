import { Router } from 'express';
import { createExpenseSchema, updateExpenseSchema } from '@trip-planner/shared-schema';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  createExpenseWithSplits,
  deleteExpenseRecord,
  listExpensesByTrip,
  updateExpenseRecord,
} from '../services/expenses.js';

export const expensesRouter = Router();

// Public read (keeps parity with legacy Supabase "public read" behavior — switch to
// requireAdmin later if you want to fully lock down).
expensesRouter.get(
  '/trips/:tripId/expenses',
  asyncHandler(async (req, res) => {
    const rows = await listExpensesByTrip(req.params.tripId as string);
    res.json(rows);
  }),
);

expensesRouter.post(
  '/expenses',
  requireAdmin,
  validate(createExpenseSchema, 'body'),
  asyncHandler(async (req, res) => {
    const body = req.body as Parameters<typeof createExpenseWithSplits>[0] & {
      splits: Parameters<typeof createExpenseWithSplits>[1];
    };
    const { splits, ...expenseInput } = body;
    const row = await createExpenseWithSplits(expenseInput, splits);
    res.status(201).json(row);
  }),
);

expensesRouter.patch(
  '/expenses/:id',
  requireAdmin,
  validate(updateExpenseSchema, 'body'),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const body = req.body as Parameters<typeof updateExpenseRecord>[1];
    const row = await updateExpenseRecord(id, body);
    res.json(row);
  }),
);

expensesRouter.delete(
  '/expenses/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await deleteExpenseRecord(req.params.id as string);
    res.status(204).end();
  }),
);
