export const REMINDER_QUEUE_NAME = 'trip-reminders';

/** Stable jobId scheme — must match what `Todo.jobId` rows store. */
export function reminderJobId(todoId: string): string {
  return `reminder:${todoId}`;
}

/**
 * Shape persisted into `email_job_logs.details`. Kept stable for admins who
 * pivot the JSON in ad-hoc queries (see docs/VERIFICATION.md).
 */
export interface EmailJobDetail {
  todo_id: string;
  task_name: string;
  trip_title: string;
  status: 'sent' | 'failed' | 'abandoned';
  retry_count: number;
  error?: string;
}

export interface ReminderJobData {
  todoId: string;
  tripId: string;
}
