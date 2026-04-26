import { Injectable } from '@nestjs/common';
import type { TripParticipant } from '@trip-planner/shared-types';
import { PrismaService } from '../prisma/prisma.service.js';
import { HttpError } from '../../common/exceptions/http.exception.js';

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

@Injectable()
export class ParticipantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tripId: string): Promise<TripParticipant[]> {
    const rows = await this.prisma.tripParticipant.findMany({
      where: { tripId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async add(
    tripId: string,
    displayName: string,
    email: string | null,
  ): Promise<TripParticipant> {
    const trimmed = displayName.trim();
    if (!trimmed) throw HttpError.badRequest('成員名稱不可為空白');
    const inserted = await this.prisma.tripParticipant.create({
      data: {
        tripId,
        displayName: trimmed,
        email: email?.trim() || null,
      },
    });
    return toDto(inserted);
  }

  /** Blocks removal when the participant is a payer or has any split in the ledger. */
  async isInLedger(tripId: string, participantId: string): Promise<boolean> {
    const payerHit = await this.prisma.expense.findFirst({
      where: { tripId, payerId: participantId },
      select: { id: true },
    });
    if (payerHit) return true;
    const splitHit = await this.prisma.expenseSplit.findFirst({
      where: {
        participantId,
        expense: { tripId },
      },
      select: { id: true },
    });
    return splitHit !== null;
  }

  async delete(participantId: string): Promise<void> {
    const row = await this.prisma.tripParticipant.findUnique({
      where: { id: participantId },
      select: { tripId: true },
    });
    if (!row) throw HttpError.notFound(`Participant ${participantId} not found`);

    if (await this.isInLedger(row.tripId, participantId)) {
      throw HttpError.conflict('此成員仍有花費或分攤紀錄，無法刪除');
    }
    await this.prisma.tripParticipant.delete({ where: { id: participantId } });
  }
}
