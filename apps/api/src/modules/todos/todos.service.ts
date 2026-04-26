import { Injectable } from '@nestjs/common';
import type { TodoItem } from '@trip-planner/shared-types';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReminderQueueService } from '../reminder/reminder.queue.service.js';

/** Mirrors legacy `services/todos.ts` — keep DB row + BullMQ job in sync. */
@Injectable()
export class TodosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reminderQueue: ReminderQueueService,
  ) {}

  /** Upsert reminder row + (re)schedule the BullMQ job. */
  async upsertReminder(tripId: string, todo: TodoItem): Promise<void> {
    if (!todo.remindTime) {
      await this.removeReminder(todo.id);
      return;
    }

    const remindAt = new Date(todo.remindTime);
    if (Number.isNaN(remindAt.getTime())) {
      throw new Error(`Invalid remindTime on todo ${todo.id}: ${todo.remindTime}`);
    }
    const delayMs = Math.max(0, remindAt.getTime() - Date.now());
    const jobId = `reminder:${todo.id}`;

    await this.prisma.todo.upsert({
      where: { id: todo.id },
      create: {
        id: todo.id,
        tripId,
        taskName: todo.text,
        reminderTime: remindAt,
        assignedParticipantId: todo.assignedParticipantId ?? null,
        isNotified: false,
        retryCount: 0,
        jobId,
      },
      update: {
        tripId,
        taskName: todo.text,
        reminderTime: remindAt,
        assignedParticipantId: todo.assignedParticipantId ?? null,
        isNotified: false,
        retryCount: 0,
        jobId,
      },
    });

    await this.reminderQueue.enqueue({
      todoId: todo.id,
      tripId,
      delayMs,
    });
  }

  async removeReminder(todoId: string): Promise<void> {
    await this.reminderQueue.cancel(todoId);
    await this.prisma.todo.deleteMany({ where: { id: todoId } });
  }
}
