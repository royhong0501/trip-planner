import { and, desc, eq } from 'drizzle-orm';
import type {
  CreateExpensePayload,
  CreateExpenseSplitPayload,
  Expense,
  ExpenseWithSplits,
  TripParticipant,
} from '@trip-planner/shared-types';
import { parseNumeric } from '@trip-planner/shared-types';
import { db } from '../db/client.js';
import {
  expenseSplits,
  expenses,
  tripParticipants,
} from '../db/schema/index.js';
import { HttpError } from '../utils/httpError.js';

function toExpenseDto(row: typeof expenses.$inferSelect): Expense {
  return {
    id: row.id,
    tripId: row.tripId,
    title: row.title,
    amountTotal: parseNumeric(row.amountTotal, 'amount_total'),
    currency: row.currency,
    exchangeRate: parseNumeric(row.exchangeRate, 'exchange_rate'),
    payerId: row.payerId,
    expenseDate:
      typeof row.expenseDate === 'string'
        ? row.expenseDate
        : new Date(row.expenseDate).toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toParticipantDto(row: typeof tripParticipants.$inferSelect): TripParticipant {
  return {
    id: row.id,
    tripId: row.tripId,
    displayName: row.displayName,
    email: row.email ?? null,
    userId: row.userId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function getExpenseWithSplits(expenseId: string): Promise<ExpenseWithSplits | null> {
  const [main] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!main) return null;
  const splits = await db
    .select()
    .from(expenseSplits)
    .where(eq(expenseSplits.expenseId, expenseId));
  const [payer] = await db
    .select()
    .from(tripParticipants)
    .where(eq(tripParticipants.id, main.payerId))
    .limit(1);
  if (!payer) throw new Error(`expense ${expenseId} payer ${main.payerId} missing`);

  return {
    ...toExpenseDto(main),
    payer: toParticipantDto(payer),
    splits: splits.map((s) => ({
      id: s.id,
      expenseId: s.expenseId,
      participantId: s.participantId,
      owedAmount: parseNumeric(s.owedAmount, 'owed_amount'),
    })),
  };
}

export async function listExpensesByTrip(tripId: string): Promise<ExpenseWithSplits[]> {
  const mains = await db
    .select()
    .from(expenses)
    .where(eq(expenses.tripId, tripId))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt));
  if (mains.length === 0) return [];

  const ids = mains.map((m) => m.id);
  const payerIds = Array.from(new Set(mains.map((m) => m.payerId)));

  const [allSplits, payers] = await Promise.all([
    db.select().from(expenseSplits).where(inList(expenseSplits.expenseId, ids)),
    db.select().from(tripParticipants).where(inList(tripParticipants.id, payerIds)),
  ]);

  const payerById = new Map(payers.map((p) => [p.id, toParticipantDto(p)]));
  const splitsByExpense = new Map<string, typeof allSplits>();
  for (const s of allSplits) {
    const bucket = splitsByExpense.get(s.expenseId) ?? [];
    bucket.push(s);
    splitsByExpense.set(s.expenseId, bucket);
  }

  return mains.map((main) => {
    const payer = payerById.get(main.payerId);
    if (!payer) throw new Error(`expense ${main.id} missing payer ${main.payerId}`);
    return {
      ...toExpenseDto(main),
      payer,
      splits: (splitsByExpense.get(main.id) ?? []).map((s) => ({
        id: s.id,
        expenseId: s.expenseId,
        participantId: s.participantId,
        owedAmount: parseNumeric(s.owedAmount, 'owed_amount'),
      })),
    };
  });
}

/**
 * Atomic replacement for the legacy `create_expense_with_splits` RPC.
 * Writes expense + expense_splits in a single transaction so we never end up
 * with an orphan main row.
 */
export async function createExpenseWithSplits(
  payload: CreateExpensePayload,
  splits: CreateExpenseSplitPayload[],
): Promise<ExpenseWithSplits> {
  if (!payload.title.trim()) throw HttpError.badRequest('花費標題不可為空白');

  const expenseId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(expenses)
      .values({
        tripId: payload.tripId,
        title: payload.title.trim(),
        amountTotal: payload.amountTotal.toString(),
        currency: (payload.currency?.trim() || 'TWD') as string,
        exchangeRate: (payload.exchangeRate ?? 1).toString(),
        payerId: payload.payerId,
        expenseDate: payload.expenseDate,
      })
      .returning({ id: expenses.id });
    if (!inserted) throw new Error('Failed to insert expense');

    if (splits.length > 0) {
      await tx.insert(expenseSplits).values(
        splits.map((s) => ({
          expenseId: inserted.id,
          participantId: s.participantId,
          owedAmount: s.owedAmount.toString(),
        })),
      );
    }
    return inserted.id;
  });

  const full = await getExpenseWithSplits(expenseId);
  if (!full) throw new Error('Failed to read expense after create');
  return full;
}

export async function updateExpenseRecord(
  id: string,
  patch: Partial<Omit<Expense, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>,
): Promise<Expense> {
  const update: Partial<typeof expenses.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) update.title = patch.title.trim();
  if (patch.amountTotal !== undefined) update.amountTotal = patch.amountTotal.toString();
  if (patch.currency !== undefined) update.currency = patch.currency;
  if (patch.exchangeRate !== undefined) update.exchangeRate = patch.exchangeRate.toString();
  if (patch.payerId !== undefined) update.payerId = patch.payerId;
  if (patch.expenseDate !== undefined) update.expenseDate = patch.expenseDate;

  const [row] = await db.update(expenses).set(update).where(eq(expenses.id, id)).returning();
  if (!row) throw HttpError.notFound(`Expense ${id} not found`);
  return toExpenseDto(row);
}

export async function deleteExpenseRecord(id: string): Promise<void> {
  const deleted = await db.delete(expenses).where(eq(expenses.id, id)).returning({ id: expenses.id });
  if (deleted.length === 0) throw HttpError.notFound(`Expense ${id} not found`);
}

// Small helper: drizzle-orm has inArray but I inline it for clarity + less deep imports.
// `inList` is a thin wrapper that avoids the explicit import dance for rare call sites.
import { inArray as inArrayImpl, type SQL, type AnyColumn } from 'drizzle-orm';
function inList<T extends AnyColumn>(col: T, values: readonly (string | number)[]): SQL<unknown> {
  return inArrayImpl(col, values as never);
}
