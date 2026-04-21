import { z } from 'zod';

export const flightDetailSchema = z.object({
  airline: z.string().default(''),
  flightNumber: z.string().default(''),
  departureTime: z.string().default(''),
  arrivalTime: z.string().default(''),
  departureAirport: z.string().default(''),
  arrivalAirport: z.string().default(''),
  checkedBaggage: z.number().int().nonnegative().default(0),
  carryOnBaggage: z.number().int().nonnegative().default(0),
});

export const flightInfoSchema = z.object({
  departure: flightDetailSchema,
  return: flightDetailSchema,
});

export const hotelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  address: z.string(),
  confirmationNumber: z.string(),
  placeId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export const activityCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  time: z.string().optional(),
  address: z.string(),
  placeId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  notes: z.string(),
});

export const dailyItinerarySchema = z.object({
  date: z.string(),
  activities: z.array(activityCardSchema),
});

export const luggageItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  checked: z.boolean(),
});

export const luggageCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  items: z.array(luggageItemSchema),
  participantId: z.string().optional(),
});

export const shoppingItemSchema = z.object({
  id: z.string(),
  status: z.enum(['incomplete', 'complete']),
  name: z.string(),
  location: z.string(),
  price: z.number(),
  participantId: z.string().optional(),
});

export const todoItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  checked: z.boolean(),
  dueAt: z.string().nullish(),
  remindTime: z.string().nullish(),
  remindOffset: z.number().int().nullish(),
  assignedParticipantId: z.string().nullish(),
});

export const tripCategorySchema = z.enum(['domestic', 'international']);
export const tripStatusSchema = z.enum(['planning', 'ongoing', 'completed']);

export const tripSchema = z.object({
  id: z.string(),
  title: z.string(),
  coverImage: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  category: tripCategorySchema,
  status: tripStatusSchema,
  todos: z.array(todoItemSchema),
  flights: flightInfoSchema,
  hotels: z.array(hotelInfoSchema),
  dailyItineraries: z.array(dailyItinerarySchema),
  luggageList: z.array(luggageCategorySchema),
  shoppingList: z.array(shoppingItemSchema),
  otherNotes: z.string(),
  weatherCities: z.array(z.string()),
  createdAt: z.string().optional(),
});

export const createTripSchema = tripSchema;

/** Update: all non-todo trip fields. todos must go through PATCH /trips/:id/todos. */
export const updateTripSchema = tripSchema.omit({ id: true, createdAt: true, todos: true }).partial();

export const updateTripListsSchema = z.object({
  luggageList: z.array(luggageCategorySchema),
  shoppingList: z.array(shoppingItemSchema),
});
