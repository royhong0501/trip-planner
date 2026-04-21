import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type {
  DailyItinerary,
  FlightInfo,
  HotelInfo,
  LuggageCategory,
  ShoppingItem,
  TodoItem,
} from '@trip-planner/shared-types';

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull().default(''),
    coverImage: text('cover_image').notNull().default(''),
    startDate: text('start_date').notNull().default(''),
    endDate: text('end_date').notNull().default(''),
    category: text('category').notNull().default('domestic'),
    status: text('status').notNull().default('planning'),
    todos: jsonb('todos').$type<TodoItem[]>().notNull().default(sql`'[]'::jsonb`),
    flights: jsonb('flights')
      .$type<FlightInfo>()
      .notNull()
      .default(sql`'{"departure":{},"return":{}}'::jsonb`),
    hotels: jsonb('hotels').$type<HotelInfo[]>().notNull().default(sql`'[]'::jsonb`),
    dailyItineraries: jsonb('daily_itineraries')
      .$type<DailyItinerary[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    luggageList: jsonb('luggage_list')
      .$type<LuggageCategory[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    shoppingList: jsonb('shopping_list')
      .$type<ShoppingItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    otherNotes: text('other_notes').notNull().default(''),
    weatherCities: jsonb('weather_cities').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'trips_category_enum',
      sql`${t.category} in ('domestic', 'international')`,
    ),
    check(
      'trips_status_enum',
      sql`${t.status} in ('planning', 'ongoing', 'completed')`,
    ),
  ],
);

export type TripRowRecord = typeof trips.$inferSelect;
export type InsertTripRow = typeof trips.$inferInsert;
