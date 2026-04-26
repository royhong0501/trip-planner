import { Injectable } from '@nestjs/common';
import type { Prisma as PrismaNamespace } from '@prisma/client';
import type {
  CreateExpensePayload,
  CreateExpenseSplitPayload,
  Expense,
  ExpenseWithSplits,
  TripParticipant,
} from '@trip-planner/shared-types';
import { parseNumeric } from '@trip-planner/shared-types';
import { PrismaService } from '../prisma/prisma.service.js';
import { HttpError } from '../../common/exceptions/http.exception.js';

type PrismaExpenseRecord = {
  id: string;
  tripId: string;
  title: string;
  amountTotal: PrismaNamespace.Decimal;
  currency: string;
  exchangeRate: PrismaNamespace.Decimal;
  payerId: string;
  expenseDate: Date | string;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaExpenseSplitRecord = {
  id: string;
  expenseId: string;
  participantId: string;
  owedAmount: PrismaNamespace.Decimal;
};

type PrismaParticipantRecord = {
  id: string;
  tripId: string;
  displayName: string;
  email: string | null;
  userId: string | null;
  createdAt: Date;
};

function toExpenseDto(row: PrismaExpenseRecord): Expense {
  return {
    id: row.id,
    tripId: row.tripId,
    title: row.title,
    amountTotal: parseNumeric(row.amountTotal.toString(), 'amount_total'),
    currency: row.currency,
    exchangeRate: parseNumeric(row.exchangeRate.toString(), 'exchange_rate'),
    payerId: row.payerId,
    expenseDate:
      typeof row.expenseDate === 'string'
        ? row.expenseDate
        : new Date(row.expenseDate).toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toParticipantDto(row: PrismaParticipantRecord): TripParticipant {
  return {
    id: row.id,
    tripId: row.tripId,
    displayName: row.displayName,
    email: row.email ?? null,
    userId: row.userId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSplitDto(s: PrismaExpenseSplitRecord) {
  return {
    id: s.id,
    expenseId: s.expenseId,
    participantId: s.participantId,
    owedAmount: parseNumeric(s.owedAmount.toString(), 'owed_amount'),
  };
}

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async listByTrip(tripId: string): Promise<ExpenseWithSplits[]> {
    const mains = await this.prisma.expense.findMany({
      where: { tripId },
      include: { splits: true, payer: true },
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    });
    return mains.map((main) => {
      if (!main.payer) throw new Error(`expense ${main.id} missing payer ${main.payerId}`);
      return {
        ...toExpenseDto(main),
        payer: toParticipantDto(main.payer),
        splits: main.splits.map(toSplitDto),
      };
    });
  }

  /**
   * Atomic replacement for the legacy `create_expense_with_splits` RPC: writes the
   * expense + expense_splits in one transaction so we never end up with an orphan.
   */
  async createWithSplits(
    payload: CreateExpensePayload,
    splits: CreateExpenseSplitPayload[],
  ): Promise<ExpenseWithSplits> {
    if (!payload.title.trim()) throw HttpError.badRequest('花費標題不可為空白');

    const expenseId = await this.prisma.$transaction(async (tx) => {
      const inserted = await tx.expense.create({
        data: {
          tripId: payload.tripId,
          title: payload.title.trim(),
          amountTotal: payload.amountTotal.toString(),
          currency: payload.currency?.trim() || 'TWD',
          exchangeRate: (payload.exchangeRate ?? 1).toString(),
          payerId: payload.payerId,
          expenseDate: new Date(payload.expenseDate),
        },
        select: { id: true },
      });

      if (splits.length > 0) {
        await tx.expenseSplit.createMany({
          data: splits.map((s) => ({
            expenseId: inserted.id,
            participantId: s.participantId,
            owedAmount: s.owedAmount.toString(),
          })),
        });
      }
      return inserted.id;
    });

    const full = await this.getWithSplits(expenseId);
    if (!full) throw new Error('Failed to read expense after create');
    return full;
  }

  async update(
    id: string,
    patch: Partial<Omit<Expense, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Expense> {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) update.title = patch.title.trim();
    if (patch.amountTotal !== undefined) update.amountTotal = patch.amountTotal.toString();
    if (patch.currency !== undefined) update.currency = patch.currency;
    if (patch.exchangeRate !== undefined) update.exchangeRate = patch.exchangeRate.toString();
    if (patch.payerId !== undefined) update.payerId = patch.payerId;
    if (patch.expenseDate !== undefined) update.expenseDate = new Date(patch.expenseDate);

    try {
      const row = await this.prisma.expense.update({ where: { id }, data: update });
      return toExpenseDto(row);
    } catch (err) {
      if (isNotFound(err)) throw HttpError.notFound(`Expense ${id} not found`);
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.expense.delete({ where: { id }, select: { id: true } });
    } catch (err) {
      if (isNotFound(err)) throw HttpError.notFound(`Expense ${id} not found`);
      throw err;
    }
  }

  private async getWithSplits(expenseId: string): Promise<ExpenseWithSplits | null> {
    const main = await this.prisma.expense.findUnique({
      where: { id: expenseId },
      include: { splits: true, payer: true },
    });
    if (!main) return null;
    if (!main.payer) throw new Error(`expense ${expenseId} payer ${main.payerId} missing`);
    return {
      ...toExpenseDto(main),
      payer: toParticipantDto(main.payer),
      splits: main.splits.map(toSplitDto),
    };
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2025'
  );
}
