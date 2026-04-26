import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  REMINDER_QUEUE_NAME,
  reminderJobId,
  type ReminderJobData,
} from './reminder.constants.js';

/**
 * Public API for enqueueing / cancelling reminder jobs. Replaces the function-style
 * `enqueueReminder/cancelReminder` exports from the legacy `queue/reminderQueue.ts`.
 */
@Injectable()
export class ReminderQueueService {
  private readonly logger = new Logger('ReminderQueueService');

  constructor(
    @InjectQueue(REMINDER_QUEUE_NAME) private readonly queue: Queue<ReminderJobData>,
    private readonly prisma: PrismaService,
  ) {}

  async enqueue(params: { todoId: string; tripId: string; delayMs: number }): Promise<void> {
    const jobId = reminderJobId(params.todoId);
    // Re-scheduling: drop the prior copy first.
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      await existing.remove().catch(() => undefined);
    }
    await this.queue.add(
      'send-reminder',
      { todoId: params.todoId, tripId: params.tripId },
      { jobId, delay: Math.max(0, params.delayMs) },
    );
  }

  async cancel(todoId: string): Promise<void> {
    const jobId = reminderJobId(todoId);
    const existing = await this.queue.getJob(jobId);
    if (!existing) return;
    await existing.remove().catch((err) => {
      this.logger.error(`failed to remove job ${jobId}`, err);
    });
  }

  /** Used by Trip deletion to clear all pending reminders for a trip. */
  async cancelAllForTrip(tripId: string): Promise<void> {
    const rows = await this.prisma.todo.findMany({
      where: { tripId },
      select: { id: true, jobId: true },
    });
    await Promise.all(
      rows.map((r) => {
        const jobId = r.jobId ?? reminderJobId(r.id);
        return this.cancelByJobId(jobId);
      }),
    );
  }

  private async cancelByJobId(jobId: string): Promise<void> {
    const existing = await this.queue.getJob(jobId);
    if (!existing) return;
    await existing.remove().catch((err) => {
      this.logger.error(`failed to remove job ${jobId}`, err);
    });
  }
}
