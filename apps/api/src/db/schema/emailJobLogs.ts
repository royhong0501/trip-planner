import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Audit trail for the reminder-email worker — one row per worker invocation. */
export const emailJobLogs = pgTable('email_job_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull(),
  totalFound: integer('total_found').notNull(),
  sentCount: integer('sent_count').notNull(),
  details: jsonb('details').$type<EmailJobDetail[]>().notNull(),
  source: text('source').notNull().default('bullmq'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface EmailJobDetail {
  todo_id: string;
  task_name: string;
  trip_title: string;
  status: 'sent' | 'failed' | 'abandoned';
  retry_count: number;
  error?: string;
}

export type EmailJobLogRecord = typeof emailJobLogs.$inferSelect;
