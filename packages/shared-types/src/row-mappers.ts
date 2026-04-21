import type {
  Expense,
  ExpenseSplit,
  ExpenseWithSplits,
  TripParticipant,
} from './expense.js';
import type { Trip, TripSummary } from './trip.js';

// --- Trip rows -----------------------------------------------------------------

export interface TripRow {
  id: string;
  title: string;
  cover_image: string;
  start_date: string;
  end_date: string;
  category: Trip['category'];
  status: Trip['status'];
  todos: Trip['todos'];
  flights: Trip['flights'];
  hotels: Trip['hotels'];
  daily_itineraries: Trip['dailyItineraries'];
  luggage_list: Trip['luggageList'];
  shopping_list: Trip['shoppingList'];
  other_notes: string;
  weather_cities?: Trip['weatherCities'];
  created_at?: string;
}

export interface TripSummaryRow {
  id: string;
  title: string;
  cover_image: string;
  start_date: string;
  end_date: string;
  category: TripSummary['category'];
  status: TripSummary['status'];
  luggage_list: TripSummary['luggageList'];
  shopping_list: TripSummary['shoppingList'];
  created_at?: string;
}

export function rowToTrip(row: TripRow): Trip {
  return {
    id: row.id,
    title: row.title,
    coverImage: row.cover_image,
    startDate: row.start_date,
    endDate: row.end_date,
    category: row.category,
    status: row.status,
    todos: row.todos ?? [],
    flights:
      row.flights ?? {
        departure: emptyFlightDetail(),
        return: emptyFlightDetail(),
      },
    hotels: row.hotels ?? [],
    dailyItineraries: row.daily_itineraries ?? [],
    luggageList: row.luggage_list ?? [],
    shoppingList: row.shopping_list ?? [],
    otherNotes: row.other_notes ?? '',
    weatherCities: row.weather_cities ?? [],
    createdAt: row.created_at,
  };
}

export function tripToRow(trip: Trip): Omit<TripRow, 'created_at'> {
  return {
    id: trip.id,
    title: trip.title,
    cover_image: trip.coverImage,
    start_date: trip.startDate,
    end_date: trip.endDate,
    category: trip.category,
    status: trip.status,
    todos: trip.todos,
    flights: trip.flights,
    hotels: trip.hotels,
    daily_itineraries: trip.dailyItineraries,
    luggage_list: trip.luggageList,
    shopping_list: trip.shoppingList,
    other_notes: trip.otherNotes,
    weather_cities: trip.weatherCities,
  };
}

export function rowToTripSummary(row: TripSummaryRow): TripSummary {
  return {
    id: row.id,
    title: row.title,
    coverImage: row.cover_image,
    startDate: row.start_date,
    endDate: row.end_date,
    category: row.category,
    status: row.status,
    luggageList: row.luggage_list ?? [],
    shoppingList: row.shopping_list ?? [],
    createdAt: row.created_at,
  };
}

function emptyFlightDetail() {
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

// --- Participant / Expense rows -----------------------------------------------

export interface TripParticipantRow {
  id: string;
  trip_id: string;
  display_name: string;
  email: string | null;
  user_id: string | null;
  created_at?: string;
}

export interface ExpenseRow {
  id: string;
  trip_id: string;
  title: string;
  amount_total: string | number;
  currency: string;
  exchange_rate: string | number;
  payer_id: string;
  expense_date: string;
  created_at?: string;
  updated_at?: string;
}

export interface ExpenseSplitRow {
  id: string;
  expense_id: string;
  participant_id: string;
  owed_amount: string | number;
}

export type ExpenseRowWithRelations = ExpenseRow & {
  payer: TripParticipantRow | TripParticipantRow[] | null;
  splits: ExpenseSplitRow[] | null;
};

export function parseNumeric(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`Cannot convert ${field} to number: ${String(value)}`);
}

export function rowToTripParticipant(row: TripParticipantRow): TripParticipant {
  return {
    id: row.id,
    tripId: row.trip_id,
    displayName: row.display_name,
    email: row.email ?? null,
    userId: row.user_id,
    createdAt: row.created_at,
  };
}

export function rowToExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    tripId: row.trip_id,
    title: row.title,
    amountTotal: parseNumeric(row.amount_total, 'amount_total'),
    currency: row.currency,
    exchangeRate: parseNumeric(row.exchange_rate, 'exchange_rate'),
    payerId: row.payer_id,
    expenseDate: row.expense_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToExpenseSplit(row: ExpenseSplitRow): ExpenseSplit {
  return {
    id: row.id,
    expenseId: row.expense_id,
    participantId: row.participant_id,
    owedAmount: parseNumeric(row.owed_amount, 'owed_amount'),
  };
}

export function rowToExpenseWithSplits(row: ExpenseRowWithRelations): ExpenseWithSplits {
  const base = rowToExpense(row);
  const payerRow = Array.isArray(row.payer) ? (row.payer[0] ?? null) : row.payer;
  if (!payerRow) {
    throw new Error(`Expense ${base.id} missing payer relation`);
  }
  return {
    ...base,
    payer: rowToTripParticipant(payerRow),
    splits: (row.splits ?? []).map(rowToExpenseSplit),
  };
}
