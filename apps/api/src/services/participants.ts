import type { TripParticipant } from '@trip-planner/shared-types';
import { prisma } from '../db/client.js';
import { HttpError } from '../utils/httpError.js';

type PrismaParticipantRecord = {
  id: string;
  tripId: string;
  displayName: string;
  email: string | null;
  userId: string | null;
  createdAt: Date;
};

function toDto(row: PrismaParticipantRecord): TripParticipant {
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
  const rows = await prisma.tripParticipant.findMany({
    where: { tripId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toDto);
}

export async function addParticipant(
  tripId: string,
  displayName: string,
  email: string | null,
): Promise<TripParticipant> {
  const trimmed = displayName.trim();
  if (!trimmed) throw HttpError.badRequest('成員名稱不可為空白');
  const inserted = await prisma.tripParticipant.create({
    data: {
      tripId,
      displayName: trimmed,
      email: email?.trim() || null,
    },
  });
  return toDto(inserted);
}

/**
 * Ported from `isTripParticipantInvolvedInLedger` in the legacy client.
 * Blocks removal when the participant is a payer or has any split in the ledger.
 */
export async function isParticipantInLedger(tripId: string, participantId: string): Promise<boolean> {
  const payerHit = await prisma.expense.findFirst({
    where: { tripId, payerId: participantId },
    select: { id: true },
  });
  if (payerHit) return true;

  const splitHit = await prisma.expenseSplit.findFirst({
    where: {
      participantId,
      expense: { tripId },
    },
    select: { id: true },
  });
  return splitHit !== null;
}

export async function deleteParticipant(participantId: string): Promise<void> {
  const row = await prisma.tripParticipant.findUnique({
    where: { id: participantId },
    select: { tripId: true },
  });
  if (!row) throw HttpError.notFound(`Participant ${participantId} not found`);

  if (await isParticipantInLedger(row.tripId, participantId)) {
    throw HttpError.conflict('此成員仍有花費或分攤紀錄，無法刪除');
  }

  await prisma.tripParticipant.delete({ where: { id: participantId } });
}
