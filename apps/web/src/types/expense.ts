/**
 * Legacy re-export. Canonical types live in @trip-planner/shared-types.
 * Kept so existing `import ... from '@/types/expense'` imports keep working.
 */
export type {
  CreateExpensePayload,
  CreateExpenseSplitPayload,
  Expense,
  ExpenseSplit,
  ExpenseWithSplits,
  TripParticipant,
} from '@trip-planner/shared-types';
