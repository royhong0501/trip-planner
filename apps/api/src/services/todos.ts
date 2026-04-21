import type { TodoItem } from '@trip-planner/shared-types';
import { prisma } from '../db/client.js';
import { enqueueReminder, cancelReminder } from '../queue/reminderQueue.js';

/**
 * Upsert a todo-reminder row and schedule / re-schedule the BullMQ job.
 * Callers: `POST /api/trips/:tripId/todos` (and on-update from patchTodos).
 */
export async function upsertTodoReminder(tripId: string, todo: TodoItem): Promise<void> {
  if (!todo.remindTime) {
    // No reminder set → make sure there is nothing lingering.
    await removeTodoReminder(todo.id);
    return;
  }

  const remindAt = new Date(todo.remindTime);
  if (Number.isNaN(remindAt.getTime())) {
    throw new Error(`Invalid remindTime on todo ${todo.id}: ${todo.remindTime}`);
  }

  const delayMs = Math.max(0, remindAt.getTime() - Date.now());
  const jobId = `reminder:${todo.id}`;

  await prisma.todo.upsert({
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

  await enqueueReminder({
    jobId,
    todoId: todo.id,
    tripId,
    delayMs,
  });
}

export async function removeTodoReminder(todoId: string): Promise<void> {
  await cancelReminder(`reminder:${todoId}`);
  await prisma.todo.deleteMany({ where: { id: todoId } });
}
