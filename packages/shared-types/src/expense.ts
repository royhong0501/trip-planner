export interface TripParticipant {
  id: string;
  tripId: string;
  displayName: string;
  email: string | null;
  userId: string | null;
  createdAt?: string;
}

export interface Expense {
  id: string;
  tripId: string;
  title: string;
  amountTotal: number;
  /** ISO 4217 */
  currency: string;
  /** How many base-currency units one `currency` unit equals; default 1. */
  exchangeRate: number;
  payerId: string;
  /** YYYY-MM-DD */
  expenseDate: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExpenseSplit {
  id: string;
  expenseId: string;
  participantId: string;
  owedAmount: number;
}

export interface ExpenseWithSplits extends Expense {
  splits: ExpenseSplit[];
  payer: TripParticipant;
}

export interface CreateExpensePayload {
  tripId: string;
  title: string;
  amountTotal: number;
  currency?: string;
  exchangeRate?: number;
  payerId: string;
  expenseDate: string;
}

export interface CreateExpenseSplitPayload {
  participantId: string;
  owedAmount: number;
}
