import type {
  CreateExpensePayload,
  CreateExpenseSplitPayload,
  Expense,
  ExpenseWithSplits,
  TripParticipant,
} from '@trip-planner/shared-types';
import { api } from './apiClient';

// Preserve the old mapper exports so code that imports from '@/lib/expenses'
// (tests / ad-hoc call sites) keeps compiling.
export {
  parseNumeric,
  rowToExpense,
  rowToExpenseSplit,
  rowToExpenseWithSplits,
  rowToTripParticipant,
} from '@trip-planner/shared-types';
export type {
  ExpenseRow,
  ExpenseRowWithRelations,
  ExpenseSplitRow,
  TripParticipantRow,
} from '@trip-planner/shared-types';

// --- Trip participants ---------------------------------------------------------

export async function getTripParticipants(tripId: string): Promise<TripParticipant[]> {
  return api.getTripParticipants(tripId);
}

export async function addTripParticipant(
  tripId: string,
  name: string,
  email?: string,
): Promise<TripParticipant> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('成員名稱不可為空白');
  return api.addTripParticipant(tripId, {
    displayName: trimmed,
    email: email?.trim() || null,
  });
}

// --- Expenses + splits ---------------------------------------------------------

export async function getExpensesByTripId(tripId: string): Promise<ExpenseWithSplits[]> {
  return api.getExpensesByTripId(tripId);
}

/**
 * The old code called `isTripParticipantInvolvedInLedger` before removing a
 * participant, so the ledger never silently dropped splits. With the new API,
 * the server enforces this as well (409 on violating delete), but we still
 * expose a pre-check so the UI can show a friendlier toast before attempting.
 */
export async function isTripParticipantInvolvedInLedger(
  tripId: string,
  participantId: string,
): Promise<boolean> {
  const expenses = await api.getExpensesByTripId(tripId);
  for (const e of expenses) {
    if (e.payerId === participantId) return true;
    if (e.splits.some((s) => s.participantId === participantId)) return true;
  }
  return false;
}

/**
 * Creates the expense + splits atomically on the server. The legacy version
 * called a Postgres RPC; the new backend wraps everything in a Node-side
 * transaction, same net effect.
 */
export async function createExpense(
  expenseData: CreateExpensePayload,
  splitsData: CreateExpenseSplitPayload[],
): Promise<ExpenseWithSplits> {
  if (!expenseData.title.trim()) throw new Error('花費標題不可為空白');
  return api.createExpense(expenseData, splitsData);
}

export async function updateExpense(expense: Expense): Promise<Expense> {
  return api.updateExpense(expense);
}

export async function deleteExpense(expenseId: string): Promise<void> {
  await api.deleteExpense(expenseId);
}

export async function deleteTripParticipant(participantId: string): Promise<void> {
  await api.deleteTripParticipant(participantId);
}
