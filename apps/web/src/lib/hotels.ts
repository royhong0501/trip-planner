import type { HotelInfo } from '@/types/trip';

const dayOf = (iso: string | undefined | null): string => (iso ?? '').split('T')[0];

/** 該日 (YYYY-MM-DD) 被覆蓋的飯店（checkIn <= d <= checkOut，且有座標）。 */
export function hotelsCoveringDay(hotels: HotelInfo[], isoDate: string): HotelInfo[] {
  const d = dayOf(isoDate);
  if (!d) return [];
  return hotels.filter(
    (h) =>
      h.lat != null &&
      h.lng != null &&
      h.checkIn &&
      h.checkOut &&
      d >= dayOf(h.checkIn) &&
      d <= dayOf(h.checkOut),
  );
}

export interface HotelDayRoles {
  /** 今日出發的飯店（昨晚住的那間；若今日為首次 checkIn 當天則為 undefined） */
  origin?: HotelInfo;
  /** 今晚入住的飯店（若今日為最終 checkOut 當天且無新 checkIn 則為 undefined） */
  destination?: HotelInfo;
  /** 當日所有覆蓋的飯店（供地圖 pin 用） */
  all: HotelInfo[];
}

/**
 * 判斷當日路線的 origin / destination：
 * - 連住中間日 (checkIn < d < checkOut)         → origin = destination = 該飯店
 * - checkIn 當天 (checkIn == d < checkOut)     → 只有 destination
 * - checkOut 當天 (checkIn < d == checkOut)    → 只有 origin
 * - 跨飯店當天 (A.checkOut == d == B.checkIn)  → origin = A, destination = B
 */
export function resolveHotelRoles(hotels: HotelInfo[], isoDate: string): HotelDayRoles {
  const d = dayOf(isoDate);
  const all = hotelsCoveringDay(hotels, d);
  const origin = all.find((h) => dayOf(h.checkIn) < d && d <= dayOf(h.checkOut));
  const destination = all.find((h) => dayOf(h.checkIn) <= d && d < dayOf(h.checkOut));
  return { origin, destination, all };
}
