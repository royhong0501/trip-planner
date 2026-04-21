export type TripCategory = 'domestic' | 'international';
export type TripStatus = 'planning' | 'ongoing' | 'completed';

export interface Trip {
  id: string;
  title: string;
  coverImage: string;
  startDate: string;
  endDate: string;
  category: TripCategory;
  status: TripStatus;
  todos: TodoItem[];
  flights: FlightInfo;
  hotels: HotelInfo[];
  dailyItineraries: DailyItinerary[];
  luggageList: LuggageCategory[];
  shoppingList: ShoppingItem[];
  otherNotes: string;
  weatherCities: string[];
  createdAt?: string;
}

/** Lightweight summary returned by GET /api/trips. */
export interface TripSummary {
  id: string;
  title: string;
  coverImage: string;
  startDate: string;
  endDate: string;
  category: TripCategory;
  status: TripStatus;
  luggageList: LuggageCategory[];
  shoppingList: ShoppingItem[];
  createdAt?: string;
}

export interface TodoItem {
  id: string;
  text: string;
  checked: boolean;
  dueAt?: string | null;
  remindTime?: string | null;
  remindOffset?: number | null;
  assignedParticipantId?: string | null;
}

export interface FlightInfo {
  departure: FlightDetail;
  return: FlightDetail;
}

export interface FlightDetail {
  airline: string;
  flightNumber: string;
  departureTime: string;
  arrivalTime: string;
  departureAirport: string;
  arrivalAirport: string;
  checkedBaggage: number;
  carryOnBaggage: number;
}

export interface HotelInfo {
  id: string;
  name: string;
  checkIn: string;
  checkOut: string;
  address: string;
  confirmationNumber: string;
  placeId?: string;
  lat?: number;
  lng?: number;
}

export interface DailyItinerary {
  date: string;
  activities: ActivityCard[];
}

export interface ActivityCard {
  id: string;
  title: string;
  type: string;
  time?: string;
  address: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  notes: string;
}

export interface LuggageCategory {
  id: string;
  name: string;
  items: LuggageItem[];
  participantId?: string;
}

export interface LuggageItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface ShoppingItem {
  id: string;
  status: 'incomplete' | 'complete';
  name: string;
  location: string;
  price: number;
  participantId?: string;
}

export interface CarouselSlide {
  id: string;
  imageUrl: string;
  title?: string;
}
