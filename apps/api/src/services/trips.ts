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
import { prisma } from '../db/client.js';
import { HttpError } from '../utils/httpError.js';

type PrismaTripRecord = {
  id: string;
  title: string;
  coverImage: string;
  startDate: string;
  endDate: string;
  category: string;
  status: string;
  todos: unknown;
  flights: unknown;
  hotels: unknown;
  dailyItineraries: unknown;
  luggageList: unknown;
  shoppingList: unknown;
  otherNotes: string;
  weatherCities: unknown;
  createdAt: Date;
};

type PrismaTripSummary = Pick<
  PrismaTripRecord,
  | 'id'
  | 'title'
  | 'coverImage'
  | 'startDate'
  | 'endDate'
  | 'category'
  | 'status'
  | 'luggageList'
  | 'shoppingList'
  | 'createdAt'
>;

function recordToRow(r: PrismaTripRecord): TripRow {
  return {
    id: r.id,
    title: r.title,
    cover_image: r.coverImage,
    start_date: r.startDate,
    end_date: r.endDate,
    category: r.category as TripRow['category'],
    status: r.status as TripRow['status'],
    todos: r.todos as TripRow['todos'],
    flights: r.flights as TripRow['flights'],
    hotels: r.hotels as TripRow['hotels'],
    daily_itineraries: r.dailyItineraries as TripRow['daily_itineraries'],
    luggage_list: r.luggageList as TripRow['luggage_list'],
    shopping_list: r.shoppingList as TripRow['shopping_list'],
    other_notes: r.otherNotes,
    weather_cities: r.weatherCities as TripRow['weather_cities'],
    created_at: r.createdAt.toISOString(),
  };
}

function summaryRecordToRow(r: PrismaTripSummary): TripSummaryRow {
  return {
    id: r.id,
    title: r.title,
    cover_image: r.coverImage,
    start_date: r.startDate,
    end_date: r.endDate,
    category: r.category as TripSummaryRow['category'],
    status: r.status as TripSummaryRow['status'],
    luggage_list: r.luggageList as TripSummaryRow['luggage_list'],
    shopping_list: r.shoppingList as TripSummaryRow['shopping_list'],
    created_at: r.createdAt.toISOString(),
  };
}

/**
 * Mirrors fetchTrips() in the legacy client: only the summary columns come back,
 * so the list view doesn't drag in daily_itineraries (base64 images) per trip.
 */
export async function listTrips(): Promise<TripSummary[]> {
  const rows = await prisma.trip.findMany({
    select: {
      id: true,
      title: true,
      coverImage: true,
      startDate: true,
      endDate: true,
      category: true,
      status: true,
      luggageList: true,
      shoppingList: true,
      createdAt: true,
    },
    orderBy: { startDate: 'desc' },
  });

  return rows.map((r) => rowToTripSummary(summaryRecordToRow(r)));
}

export async function getTripById(id: string): Promise<Trip | null> {
  const row = await prisma.trip.findUnique({ where: { id } });
  if (!row) return null;
  return rowToTrip(recordToRow(row));
}

export async function createTripRecord(trip: Trip): Promise<Trip> {
  const inserted = await prisma.trip.create({
    data: {
      title: trip.title,
      coverImage: trip.coverImage,
      startDate: trip.startDate,
      endDate: trip.endDate,
      category: trip.category,
      status: trip.status,
      todos: trip.todos as object,
      flights: trip.flights as object,
      hotels: trip.hotels as object,
      dailyItineraries: trip.dailyItineraries as object,
      luggageList: trip.luggageList as object,
      shoppingList: trip.shoppingList as object,
      otherNotes: trip.otherNotes,
      weatherCities: trip.weatherCities as object,
    },
  });
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

  const update: Record<string, unknown> = {};
  if (rest.title !== undefined) update.title = rest.title;
  if (rest.coverImage !== undefined) update.coverImage = rest.coverImage;
  if (rest.startDate !== undefined) update.startDate = rest.startDate;
  if (rest.endDate !== undefined) update.endDate = rest.endDate;
  if (rest.category !== undefined) update.category = rest.category;
  if (rest.status !== undefined) update.status = rest.status;
  if (rest.flights !== undefined) update.flights = rest.flights as object;
  if (rest.hotels !== undefined) update.hotels = rest.hotels as object;
  if (rest.dailyItineraries !== undefined) update.dailyItineraries = rest.dailyItineraries as object;
  if (rest.luggageList !== undefined) update.luggageList = rest.luggageList as object;
  if (rest.shoppingList !== undefined) update.shoppingList = rest.shoppingList as object;
  if (rest.otherNotes !== undefined) update.otherNotes = rest.otherNotes;
  if (rest.weatherCities !== undefined) update.weatherCities = rest.weatherCities as object;

  try {
    const row = await prisma.trip.update({ where: { id }, data: update });
    return rowToTrip(recordToRow(row));
  } catch (err) {
    if (isNotFoundError(err)) throw HttpError.notFound(`Trip ${id} not found`);
    throw err;
  }
}

export async function updateTripLists(
  id: string,
  luggageList: LuggageCategory[],
  shoppingList: ShoppingItem[],
): Promise<void> {
  try {
    await prisma.trip.update({
      where: { id },
      data: {
        luggageList: luggageList as object,
        shoppingList: shoppingList as object,
      },
      select: { id: true },
    });
  } catch (err) {
    if (isNotFoundError(err)) throw HttpError.notFound(`Trip ${id} not found`);
    throw err;
  }
}

export async function deleteTripRecord(id: string): Promise<void> {
  // Reminder rows cascade via FK, but we clear them first inside the same tx so
  // the route layer's post-commit queue cancellation sees a consistent set.
  await prisma.$transaction(async (tx) => {
    await tx.todo.deleteMany({ where: { tripId: id } });
    try {
      await tx.trip.delete({ where: { id } });
    } catch (err) {
      if (isNotFoundError(err)) throw HttpError.notFound(`Trip ${id} not found`);
      throw err;
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
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ todos: TodoItem[] }>>`
      select todos from trips where id = ${tripId}::uuid for update
    `;
    const firstRow = rows[0];
    if (!firstRow) {
      throw HttpError.notFound(`Trip ${tripId} not found`);
    }

    const fresh = (firstRow.todos ?? []) as TodoItem[];
    const next = mutator(fresh);

    await tx.trip.update({
      where: { id: tripId },
      data: { todos: next as object },
      select: { id: true },
    });
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
  return prisma.todo.findMany({
    where: { tripId },
    orderBy: { reminderTime: 'asc' },
  });
}

/** Prisma throws P2025 when update/delete targets a missing row. */
function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2025'
  );
}
