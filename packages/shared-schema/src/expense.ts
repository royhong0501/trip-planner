import { z } from 'zod';

export const createExpenseSplitSchema = z.object({
  participantId: z.string().uuid(),
  owedAmount: z.number().nonnegative(),
});

export const createExpenseSchema = z.object({
  tripId: z.string().uuid(),
  title: z.string().trim().min(1, '花費標題不可為空白'),
  amountTotal: z.number().nonnegative(),
  currency: z.string().min(1).default('TWD'),
  exchangeRate: z.number().positive().default(1),
  payerId: z.string().uuid(),
  /** YYYY-MM-DD */
  expenseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'expenseDate must be YYYY-MM-DD'),
  splits: z.array(createExpenseSplitSchema),
});

export const updateExpenseSchema = createExpenseSchema
  .omit({ tripId: true, splits: true })
  .partial()
  .extend({
    id: z.string().uuid(),
  });

export const addParticipantSchema = z.object({
  displayName: z.string().trim().min(1, '成員名稱不可為空白'),
  email: z.string().email().nullish(),
});
