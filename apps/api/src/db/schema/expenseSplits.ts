import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { expenses } from './expenses.js';
import { tripParticipants } from './participants.js';

export const expenseSplits = pgTable(
  'expense_splits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => tripParticipants.id, { onDelete: 'cascade' }),
    owedAmount: numeric('owed_amount', { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [
    check('expense_splits_owed_non_negative', sql`${t.owedAmount} >= 0`),
    unique('expense_splits_expense_participant_unique').on(t.expenseId, t.participantId),
    index('expense_splits_expense_id_idx').on(t.expenseId),
    index('expense_splits_participant_id_idx').on(t.participantId),
  ],
);

export type ExpenseSplitRecord = typeof expenseSplits.$inferSelect;
export type InsertExpenseSplit = typeof expenseSplits.$inferInsert;
