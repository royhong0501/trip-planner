import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trips } from './trips.js';

export const tripParticipants = pgTable(
  'trip_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    /** Porting over from the Supabase schema where email lives alongside the participant. */
    email: text('email'),
    /** Kept for forward-compat with admin-user linkage; may be null. */
    userId: uuid('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'trip_participants_display_name_not_empty',
      sql`char_length(trim(${t.displayName})) > 0`,
    ),
    index('trip_participants_trip_id_idx').on(t.tripId),
  ],
);

export type TripParticipantRecord = typeof tripParticipants.$inferSelect;
export type InsertTripParticipant = typeof tripParticipants.$inferInsert;
