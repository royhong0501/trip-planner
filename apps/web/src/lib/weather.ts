/**
 * Weather helpers. Requests now go through our backend (`/api/weather`,
 * `/api/weather/geocode`) instead of OpenWeather directly — the server holds
 * the API key and caches responses in Redis. We still keep a thin
 * localStorage cache (30 min) on top so UI remounts don't re-hit the API.
 */

import type {
  CurrentWeatherPayload,
  ForecastHourItem,
  GeoCityHit,
  WeatherBundle,
} from '@trip-planner/shared-types';
import { api } from './apiClient';

export type { CurrentWeatherPayload, ForecastHourItem, GeoCityHit, WeatherBundle };

const CACHE_PREFIX = 'weatherBundleCache_v1:';
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Strip embedded coords suffix before comparing ("City, CC|lat,lon" → "city, cc") */
export function normalizeCityKey(name: string): string {
  return name.split('|')[0].trim().toLowerCase();
}

interface CacheEnvelope {
  ts: number;
  data: WeatherBundle;
}

function isWeatherBundle(x: unknown): x is WeatherBundle {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    Array.isArray(o.forecast48h) &&
    typeof o.current === 'object' &&
    o.current !== null
  );
}

function readCache(cityKey: string): CacheEnvelope | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + normalizeCityKey(cityKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope;
    if (!parsed || typeof parsed.ts !== 'number' || !isWeatherBundle(parsed.data)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cityKey: string, data: WeatherBundle): void {
  if (typeof window === 'undefined') return;
  const env: CacheEnvelope = { ts: Date.now(), data };
  window.localStorage.setItem(CACHE_PREFIX + normalizeCityKey(cityKey), JSON.stringify(env));
}

/**
 * Fetch current weather + 48h forecast for a tracked-city label.
 *
 * Supports two label formats:
 *  - Legacy: `"Taipei, TW"` — needs a geocode round-trip to get lat/lon.
 *  - New: `"Okinawa Island, JP|26.2124,127.6809"` — coords embedded, skip geocoding.
 */
export async function fetchWeatherWithCache(cityEntry: string): Promise<WeatherBundle | null> {
  const trimmed = cityEntry.trim();
  if (!trimmed) return null;

  const cached = readCache(trimmed);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  let { lat, lon } = parseTrackedCityLabel(trimmed);
  if (lat === undefined || lon === undefined) {
    const hits = await api.geocodeCity(trimmed.split('|')[0]!, 1).catch(() => [] as GeoCityHit[]);
    const first = hits[0];
    if (!first) return null;
    lat = first.lat;
    lon = first.lon;
  }

  const bundle = await api
    .fetchWeather({ lat, lon, label: trimmed })
    .catch(() => null);
  if (!bundle) return null;
  writeCache(trimmed, bundle);
  return bundle;
}

/** Geocoding preview (used by the "add tracked city" dropdown). */
export async function searchCityPreview(query: string): Promise<GeoCityHit[]> {
  const q = query.trim();
  if (!q) return [];
  return api.geocodeCity(q, 5).catch(() => []);
}

/** Fetch weather + forecast directly from coordinates (when adding a tracked city). */
export async function fetchWeatherByCoordsWithCache(
  lat: number,
  lon: number,
  cacheKey: string,
): Promise<WeatherBundle | null> {
  const trimmed = cacheKey.trim();
  if (!trimmed) return null;

  const cached = readCache(trimmed);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const bundle = await api.fetchWeather({ lat, lon, label: trimmed }).catch(() => null);
  if (!bundle) return null;
  writeCache(trimmed, bundle);
  return bundle;
}

/**
 * Format: `"Okinawa Island, JP|26.2124,127.6809"`
 * Embedding coords lets cache-expired refetches skip the geocode step and
 * avoid OWM "city not found" 404s for ambiguous names.
 */
export function formatTrackedCityLabel(hit: GeoCityHit): string {
  return `${hit.name}, ${hit.country}|${hit.lat.toFixed(4)},${hit.lon.toFixed(4)}`;
}

/**
 * Parse a tracked-city label. Supports legacy `"Taipei, TW"` and new
 * `"Okinawa Island, JP|lat,lon"` formats.
 */
export function parseTrackedCityLabel(queryKey: string): {
  cityName: string;
  countryCode: string;
  lat?: number;
  lon?: number;
} {
  const [base, coordsPart] = queryKey.split('|');
  let lat: number | undefined;
  let lon: number | undefined;
  if (coordsPart) {
    const [a, b] = coordsPart.split(',');
    if (a && b) {
      const parsedLat = parseFloat(a);
      const parsedLon = parseFloat(b);
      if (Number.isFinite(parsedLat) && Number.isFinite(parsedLon)) {
        lat = parsedLat;
        lon = parsedLon;
      }
    }
  }

  const trimmed = (base ?? '').trim();
  const lastComma = trimmed.lastIndexOf(',');
  if (lastComma <= 0) return { cityName: trimmed, countryCode: '', lat, lon };
  return {
    cityName: trimmed.slice(0, lastComma).trim(),
    countryCode: trimmed.slice(lastComma + 1).trim(),
    lat,
    lon,
  };
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Bucket the 48h forecast into per-local-day groups with display labels
 * (今天 / 明天 / 後天 / n月n日).
 */
export function groupForecastByDay(
  items: ForecastHourItem[],
  now: Date = new Date(),
): { dayKey: string; label: string; items: ForecastHourItem[] }[] {
  if (items.length === 0) return [];

  const todayStart = startOfLocalDay(now);
  const dayMs = 24 * 60 * 60 * 1000;

  const groups = new Map<string, ForecastHourItem[]>();
  const order: string[] = [];

  for (const it of items) {
    const d = new Date(it.dt * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!groups.has(key)) {
      order.push(key);
      groups.set(key, []);
    }
    groups.get(key)!.push(it);
  }

  return order.map((dayKey) => {
    const first = groups.get(dayKey)![0]!;
    const thatDay = new Date(first.dt * 1000);
    const thatStart = startOfLocalDay(thatDay);
    const diffDays = Math.round((thatStart - todayStart) / dayMs);

    let label: string;
    const md = `${thatDay.getMonth() + 1}月${thatDay.getDate()}日`;
    if (diffDays === 0) label = `今天 · ${md}`;
    else if (diffDays === 1) label = `明天 · ${md}`;
    else if (diffDays === 2) label = `後天 · ${md}`;
    else label = md;

    return { dayKey, label, items: groups.get(dayKey)! };
  });
}

/** Single-row time display (e.g. 15:00). */
export function formatForecastTime(dtSeconds: number): string {
  const d = new Date(dtSeconds * 1000);
  return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}
