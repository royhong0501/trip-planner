/**
 * Legacy re-export. The canonical types now live in @trip-planner/shared-types
 * so the API client and server see the same shapes. Kept here only so existing
 * `import ... from '@/types/trip'` call sites don't need to change.
 */
export type {
  ActivityCard,
  CarouselSlide,
  DailyItinerary,
  FlightDetail,
  FlightInfo,
  HotelInfo,
  LuggageCategory,
  LuggageItem,
  ShoppingItem,
  TodoItem,
  Trip,
  TripSummary,
} from '@trip-planner/shared-types';
