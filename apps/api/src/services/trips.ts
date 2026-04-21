import { asc, desc, eq, sql } from 'drizzle-orm';
import { rowToTrip, rowToTripSummary } from '@trip-planner/shared-types';
import type {
  LuggageCategory,
  ShoppingItem,
  TodoItem,
  Trip,
  TripRow,
  TripSummary,
  TripSummaryRow,
} from '@trip-planner/shared-types';
import { db } from '../db/client.js';
import { todos as todoRemindersTable, trips } from '../db/schema/index.js';
import { HttpError } from '../utils/httpError.js';

function recordToRow(r: typeof trips.$inferSelect): TripRow {
  return {
    id: r.id,
    title: r.title,
    cover_image: r.coverImage,
    start_date: r.startDate,
    end_date: r.endDate,
    category: r.category as TripRow['category'],
    status: r.status as TripRow['status'],
    todos: r.todos,
    flights: r.flights,
    hotels: r.hotels,
    daily_itineraries: r.dailyItineraries,
    luggage_list: r.luggageList,
    shopping_list: r.shoppingList,
    other_notes: r.otherNotes,
    weather_cities: r.weatherCities,
    created_at: r.createdAt.toISOString(),
  };
}

function summaryRecordToRow(r: {
  id: string;
  title: string;
  coverImage: string;
  startDate: string;
  endDate: string;
  category: string;
  status: string;
  luggageList: LuggageCategory[];
  shoppingList: ShoppingItem[];
  createdAt: Date;
}): TripSummaryRow {
  return {
    id: r.id,
    title: r.title,
    cover_image: r.coverImage,
    start_date: r.startDate,
    end_date: r.endDate,
    category: r.category as TripSummaryRow['category'],
    status: r.status as TripSummaryRow['status'],
    luggage_list: r.luggageList,
    shopping_list: r.shoppingList,
    created_at: r.createdAt.toISOString(),
  };
}

/**
 * Mirrors fetchTrips() in the legacy client: only the summary columns come back,
 * so the list view doesn't drag in daily_itineraries (base64 images) per trip.
 */
export async function listTrips(): Promise<TripSummary[]> {
  const rows = await db
    .select({
      id: trips.id,
      title: trips.title,
      coverImage: trips.coverImage,
      startDate: trips.startDate,
      endDate: trips.endDate,
      category: trips.category,
      status: trips.status,
      luggageList: trips.luggageList,
      shoppingList: trips.shoppingList,
      createdAt: trips.createdAt,
    })
    .from(trips)
    .orderBy(desc(trips.startDate));

  return rows.map((r) => rowToTripSummary(summaryRecordToRow(r)));
}

export async function getTripById(id: string): Promise<Trip | null> {
  const [row] = await db.select().from(trips).where(eq(trips.id, id)).limit(1);
  if (!row) return null;
  return rowToTrip(recordToRow(row));
}

export async function createTripRecord(trip: Trip): Promise<Trip> {
  const [inserted] = await db
    .insert(trips)
    .values({
      title: trip.title,
      coverImage: trip.coverImage,
      startDate: trip.startDate,
      endDate: trip.endDate,
      category: trip.category,
      status: trip.status,
      todos: trip.todos,
      flights: trip.flights,
      hotels: trip.hotels,
      dailyItineraries: trip.dailyItineraries,
      luggageList: trip.luggageList,
      shoppingList: trip.shoppingList,
      otherNotes: trip.otherNotes,
      weatherCities: trip.weatherCities,
    })
    .returning();
  if (!inserted) throw new Error('Failed to insert trip');
  return rowToTrip(recordToRow(inserted));
}

/**
 * Update everything EXCEPT todos.
 *
 * Preserves the existing frontend contract: TripEditor won't overwrite a newly
 * created todo that arrived after the user opened the editor (see the
 * `patchTripTodos` comment in the old repo).
 */
export async function updateTripRecord(id: string, partial: Partial<Trip>): Promise<Trip> {
  const { todos: _ignored, id: _ignoredId, createdAt: _ignoredCreated, ...rest } = partial;

  const update: Partial<typeof trips.$inferInsert> = {};
  if (rest.title !== undefined) update.title = rest.title;
  if (rest.coverImage !== undefined) update.coverImage = rest.coverImage;
  if (rest.startDate !== undefined) update.startDate = rest.startDate;
  if (rest.endDate !== undefined) update.endDate = rest.endDate;
  if (rest.category !== undefined) update.category = rest.category;
  if (rest.status !== undefined) update.status = rest.status;
  if (rest.flights !== undefined) update.flights = rest.flights;
  if (rest.hotels !== undefined) update.hotels = rest.hotels;
  if (rest.dailyItineraries !== undefined) update.dailyItineraries = rest.dailyItineraries;
  if (rest.luggageList !== undefined) update.luggageList = rest.luggageList;
  if (rest.shoppingList !== undefined) update.shoppingList = rest.shoppingList;
  if (rest.otherNotes !== undefined) update.otherNotes = rest.otherNotes;
  if (rest.weatherCities !== undefined) update.weatherCities = rest.weatherCities;

  const [row] = await db.update(trips).set(update).where(eq(trips.id, id)).returning();
  if (!row) throw HttpError.notFound(`Trip ${id} not found`);
  return rowToTrip(recordToRow(row));
}

export async function updateTripLists(
  id: string,
  luggageList: LuggageCategory[],
  shoppingList: ShoppingItem[],
): Promise<void> {
  const result = await db
    .update(trips)
    .set({ luggageList, shoppingList })
    .where(eq(trips.id, id))
    .returning({ id: trips.id });
  if (result.length === 0) throw HttpError.notFound(`Trip ${id} not found`);
}

export async function deleteTripRecord(id: string): Promise<void> {
  // Cascade via FK will remove participants + expenses + splits. todos reminder rows
  // cascade too (FK on trip_id). We wrap both in a transaction so cancel-queue can
  // happen alongside (done in the route layer after the tx commits).
  await db.transaction(async (tx) => {
    await tx.delete(todoRemindersTable).where(eq(todoRemindersTable.tripId, id));
    const deleted = await tx.delete(trips).where(eq(trips.id, id)).returning({ id: trips.id });
    if (deleted.length === 0) {
      throw HttpError.notFound(`Trip ${id} not found`);
    }
  });
}

/**
 * Server-side read-modify-write for the trips.todos JSONB column.
 *
 * Uses SELECT ... FOR UPDATE so two concurrent admins can't fight over a stale
 * snapshot (regression we saw in the old repo: user got a reminder email but
 * could not find the todo in the editor because an earlier save had dropped it).
 */
export async function patchTripTodos(
  tripId: string,
  mutator: (todos: TodoItem[]) => TodoItem[],
): Promise<TodoItem[]> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(
      sql`select todos from trips where id = ${tripId} for update`,
    );
    const firstRow = rows.rows[0] as { todos: TodoItem[] } | undefined;
    if (!firstRow) {
      throw HttpError.notFound(`Trip ${tripId} not found`);
    }

    const fresh = (firstRow.todos ?? []) as TodoItem[];
    const next = mutator(fresh);

    await tx.update(trips).set({ todos: next }).where(eq(trips.id, tripId));
    return next;
  });
}

/** Apply a single op (add/update/toggle/remove) against the current todo list. */
export function applyTodoOp(
  current: TodoItem[],
  op:
    | { type: 'add'; todo: TodoItem }
    | { type: 'update'; id: string; patch: Partial<TodoItem> }
    | { type: 'toggle'; id: string; checked: boolean }
    | { type: 'remove'; id: string },
): TodoItem[] {
  switch (op.type) {
    case 'add': {
      if (current.some((t) => t.id === op.todo.id)) return current;
      return [...current, op.todo];
    }
    case 'update': {
      return current.map((t) => (t.id === op.id ? { ...t, ...op.patch, id: t.id } : t));
    }
    case 'toggle': {
      return current.map((t) => (t.id === op.id ? { ...t, checked: op.checked } : t));
    }
    case 'remove': {
      return current.filter((t) => t.id !== op.id);
    }
  }
}

/** Used by admin ad-hoc debugging + tests. Ordered chronologically. */
export async function listTodoReminders(tripId: string) {
  return db
    .select()
    .from(todoRemindersTable)
    .where(eq(todoRemindersTable.tripId, tripId))
    .orderBy(asc(todoRemindersTable.reminderTime));
}
