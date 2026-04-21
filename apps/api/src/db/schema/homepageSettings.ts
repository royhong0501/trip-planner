import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const homepageSettings = pgTable('homepage_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull().default(sql`'null'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type HomepageSettingRecord = typeof homepageSettings.$inferSelect;
export type InsertHomepageSetting = typeof homepageSettings.$inferInsert;
