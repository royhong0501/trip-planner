import { eq } from 'drizzle-orm';
import type { TodoItem } from '@trip-planner/shared-types';
import { db } from '../db/client.js';
import { todos as todoRemindersTable } from '../db/schema/index.js';
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

  await db
    .insert(todoRemindersTable)
    .values({
      id: todo.id,
      tripId,
      taskName: todo.text,
      reminderTime: remindAt,
      assignedParticipantId: todo.assignedParticipantId ?? null,
      isNotified: false,
      retryCount: 0,
      jobId,
    })
    .onConflictDoUpdate({
      target: todoRemindersTable.id,
      set: {
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
  await db.delete(todoRemindersTable).where(eq(todoRemindersTable.id, todoId));
}
