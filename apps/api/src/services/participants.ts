import { and, asc, eq } from 'drizzle-orm';
import type { TripParticipant } from '@trip-planner/shared-types';
import { db } from '../db/client.js';
import { expenseSplits, expenses, tripParticipants } from '../db/schema/index.js';
import { HttpError } from '../utils/httpError.js';

function toDto(row: typeof tripParticipants.$inferSelect): TripParticipant {
  return {
    id: row.id,
    tripId: row.tripId,
    displayName: row.displayName,
    email: row.email ?? null,
    userId: row.userId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listParticipants(tripId: string): Promise<TripParticipant[]> {
  const rows = await db
    .select()
    .from(tripParticipants)
    .where(eq(tripParticipants.tripId, tripId))
    .orderBy(asc(tripParticipants.createdAt));
  return rows.map(toDto);
}

export async function addParticipant(
  tripId: string,
  displayName: string,
  email: string | null,
): Promise<TripParticipant> {
  const trimmed = displayName.trim();
  if (!trimmed) throw HttpError.badRequest('成員名稱不可為空白');
  const [inserted] = await db
    .insert(tripParticipants)
    .values({
      tripId,
      displayName: trimmed,
      email: email?.trim() || null,
    })
    .returning();
  if (!inserted) throw new Error('Failed to insert participant');
  return toDto(inserted);
}

/**
 * Ported from `isTripParticipantInvolvedInLedger` in the legacy client.
 * Blocks removal when the participant is a payer or has any split in the ledger.
 */
export async function isParticipantInLedger(tripId: string, participantId: string): Promise<boolean> {
  const payerHit = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.tripId, tripId), eq(expenses.payerId, participantId)))
    .limit(1);
  if (payerHit.length > 0) return true;

  const splitHit = await db
    .select({ id: expenseSplits.id })
    .from(expenseSplits)
    .innerJoin(expenses, eq(expenses.id, expenseSplits.expenseId))
    .where(and(eq(expenses.tripId, tripId), eq(expenseSplits.participantId, participantId)))
    .limit(1);
  return splitHit.length > 0;
}

export async function deleteParticipant(participantId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(tripParticipants)
    .where(eq(tripParticipants.id, participantId))
    .limit(1);
  if (!row) throw HttpError.notFound(`Participant ${participantId} not found`);

  if (await isParticipantInLedger(row.tripId, participantId)) {
    throw HttpError.conflict('此成員仍有花費或分攤紀錄，無法刪除');
  }

  await db.delete(tripParticipants).where(eq(tripParticipants.id, participantId));
}
