import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tripParticipants } from './participants.js';
import { trips } from './trips.js';

/**
 * Reminder-email backing table. Mirrors the Supabase layout: one row per todo that
 * has a reminder_time. BullMQ is the primary scheduler now; this table stays so
 * email_job_logs / audits can still point at a stable row.
 */
export const todos = pgTable('todos', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  taskName: text('task_name').notNull(),
  reminderTime: timestamp('reminder_time', { withTimezone: true }).notNull(),
  assignedParticipantId: uuid('assigned_participant_id').references(
    () => tripParticipants.id,
    { onDelete: 'set null' },
  ),
  isNotified: boolean('is_notified').notNull().default(false),
  retryCount: integer('retry_count').notNull().default(0),
  /** BullMQ job id, so we can cancel when the todo is removed / remindTime changes. */
  jobId: text('job_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TodoReminderRecord = typeof todos.$inferSelect;
export type InsertTodoReminder = typeof todos.$inferInsert;
