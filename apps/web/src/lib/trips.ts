import type {
  LuggageCategory,
  ShoppingItem,
  TodoItem,
  Trip,
  TripSummary,
} from '@trip-planner/shared-types';
import { api } from './apiClient';

// Re-export row types + mappers from shared-types for any legacy consumer that
// imported them from '@/lib/trips' (we kept the names identical).
export {
  rowToTrip,
  tripToRow,
  rowToTripSummary,
} from '@trip-planner/shared-types';
export type {
  TripRow,
  TripSummaryRow,
} from '@trip-planner/shared-types';

/**
 * Lightweight list — the backend sends only summary columns, same shape the UI
 * already consumed (daily_itineraries / todos / flights / hotels etc. are excluded).
 *
 * Returns `Trip[]` with empty defaults for the missing fields, so code that
 * destructured a full Trip keeps working.
 */
export async function fetchTrips(): Promise<Trip[]> {
  const summaries = await api.listTrips();
  return summaries.map(summaryToHollowTrip);
}

export async function fetchTripById(id: string): Promise<Trip | null> {
  return api.getTrip(id);
}

export async function createTrip(trip: Trip): Promise<Trip> {
  return api.createTrip(trip);
}

/** Update everything except todos — todos flow through patchTripTodos. */
export async function updateTrip(trip: Trip): Promise<Trip> {
  return api.updateTrip(trip);
}

export async function updateTripLists(
  id: string,
  luggageList: LuggageCategory[],
  shoppingList: ShoppingItem[],
): Promise<void> {
  await api.updateTripLists(id, { luggageList, shoppingList });
}

export async function deleteTrip(id: string): Promise<void> {
  await api.deleteTrip(id);
}

export async function insertTodoRow(tripId: string, todo: TodoItem): Promise<void> {
  if (!todo.remindTime) return;
  await api.insertTodoRow(tripId, todo);
}

/**
 * Server-side read-modify-write for trips.todos (identical contract to the old
 * Supabase path — the server does the fetch/merge/write transactionally).
 * We upload the full next array via `replace` so the client-side mutator lambda
 * keeps working without a protocol change.
 */
export async function patchTripTodos(
  tripId: string,
  mutator: (todos: TodoItem[]) => TodoItem[],
): Promise<TodoItem[]> {
  const current = (await api.getTrip(tripId))?.todos ?? [];
  const next = mutator(current);
  return api.patchTripTodos(tripId, { replace: next });
}

export async function deleteTodoRow(todoId: string): Promise<void> {
  await api.deleteTodoRow(todoId);
}

function summaryToHollowTrip(summary: TripSummary): Trip {
  return {
    id: summary.id,
    title: summary.title,
    coverImage: summary.coverImage,
    startDate: summary.startDate,
    endDate: summary.endDate,
    category: summary.category,
    status: summary.status,
    todos: [],
    flights: {
      departure: emptyFlight(),
      return: emptyFlight(),
    },
    hotels: [],
    dailyItineraries: [],
    luggageList: summary.luggageList ?? [],
    shoppingList: summary.shoppingList ?? [],
    otherNotes: '',
    weatherCities: [],
    createdAt: summary.createdAt,
  };
}

function emptyFlight() {
  return {
    airline: '',
    flightNumber: '',
    departureTime: '',
    arrivalTime: '',
    departureAirport: '',
    arrivalAirport: '',
    checkedBaggage: 0,
    carryOnBaggage: 0,
  };
}
