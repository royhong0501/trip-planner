import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tripParticipants } from './participants.js';
import { trips } from './trips.js';

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    amountTotal: numeric('amount_total', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('TWD'),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 8 }).notNull().default('1'),
    payerId: uuid('payer_id')
      .notNull()
      .references(() => tripParticipants.id, { onDelete: 'restrict' }),
    expenseDate: date('expense_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('expenses_amount_total_non_negative', sql`${t.amountTotal} >= 0`),
    check('expenses_exchange_rate_positive', sql`${t.exchangeRate} > 0`),
    check('expenses_title_not_empty', sql`char_length(trim(${t.title})) > 0`),
    index('expenses_trip_id_idx').on(t.tripId),
    index('expenses_trip_id_expense_date_desc_idx').on(t.tripId, t.expenseDate.desc()),
  ],
);

export type ExpenseRecord = typeof expenses.$inferSelect;
export type InsertExpense = typeof expenses.$inferInsert;
