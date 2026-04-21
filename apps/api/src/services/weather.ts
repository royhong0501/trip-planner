import type { GeoCityHit, WeatherBundle } from '@trip-planner/shared-types';
import { env } from '../config/env.js';
import { readJson, writeJson } from '../cache/redis.js';

const CACHE_TTL_SECONDS = 30 * 60;
const GEOCODE_TTL_SECONDS = 60 * 60 * 24;
const FORECAST_STEPS = 16;

export class WeatherApiKeyMissingError extends Error {
  constructor() {
    super('OPENWEATHER_API_KEY is not configured');
    this.name = 'WeatherApiKeyMissingError';
  }
}

/** Public helper mirroring the old frontend API shape. */
export async function fetchWeatherBundle(params: {
  lat: number;
  lon: number;
  lang: string;
  /** Optional cache label (queryKey); defaults to "{lat},{lon}". */
  label?: string;
}): Promise<WeatherBundle | null> {
  const apiKey = env.OPENWEATHER_API_KEY;
  if (!apiKey) throw new WeatherApiKeyMissingError();

  const lat = round4(params.lat);
  const lon = round4(params.lon);
  const cacheKey = `weather:${lat}:${lon}:${params.lang}`;

  const cached = await readJson<WeatherBundle>(cacheKey);
  if (cached) return cached;

  const weatherUrl = new URL('https://api.openweathermap.org/data/2.5/weather');
  const forecastUrl = new URL('https://api.openweathermap.org/data/2.5/forecast');
  for (const u of [weatherUrl, forecastUrl]) {
    u.searchParams.set('units', 'metric');
    u.searchParams.set('lang', params.lang);
    u.searchParams.set('appid', apiKey);
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lon));
  }

  const [weatherRes, forecastRes] = await Promise.all([
    fetch(weatherUrl.toString()),
    fetch(forecastUrl.toString()),
  ]);

  if (!weatherRes.ok) {
    if (weatherRes.status === 404) return null;
    throw new Error(`OpenWeather /weather failed: ${weatherRes.status}`);
  }

  const weatherJson = (await weatherRes.json()) as Record<string, unknown>;
  const queryKey = params.label ?? `${lat},${lon}`;
  const current = mapWeatherResponse(weatherJson, queryKey);

  let forecast48h: WeatherBundle['forecast48h'] = [];
  if (forecastRes.ok) {
    const forecastJson = (await forecastRes.json()) as { list?: unknown[] };
    const list = Array.isArray(forecastJson.list) ? forecastJson.list : [];
    forecast48h = mapForecastList(list);
  }

  const bundle: WeatherBundle = { current, forecast48h };
  await writeJson(cacheKey, bundle, CACHE_TTL_SECONDS);
  return bundle;
}

export async function geocodeCity(q: string, limit: number): Promise<GeoCityHit[]> {
  const apiKey = env.OPENWEATHER_API_KEY;
  if (!apiKey) throw new WeatherApiKeyMissingError();

  const cacheKey = `geocode:${q.toLowerCase()}:${limit}`;
  const cached = await readJson<GeoCityHit[]>(cacheKey);
  if (cached) return cached;

  const url = new URL('https://api.openweathermap.org/geo/1.0/direct');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('appid', apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const arr = (await res.json()) as Array<{
    name: string;
    country: string;
    state?: string;
    lat: number;
    lon: number;
  }>;
  const hits: GeoCityHit[] = arr.map((r) => ({
    name: r.name,
    country: r.country,
    state: r.state,
    lat: r.lat,
    lon: r.lon,
  }));
  await writeJson(cacheKey, hits, GEOCODE_TTL_SECONDS);
  return hits;
}

function mapWeatherResponse(json: Record<string, unknown>, queryKey: string) {
  const name = typeof json.name === 'string' ? json.name : queryKey;
  const main = json.main as { temp?: number } | undefined;
  const weatherArr = json.weather as Array<{ description?: string; icon?: string }> | undefined;
  const w0 = weatherArr?.[0];
  const tempC = typeof main?.temp === 'number' ? main.temp : NaN;
  const description = typeof w0?.description === 'string' ? w0.description : '';
  const iconCode = typeof w0?.icon === 'string' ? w0.icon : '01d';
  const iconUrl = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
  const sys = json.sys as { country?: string } | undefined;
  return {
    name,
    country: typeof sys?.country === 'string' ? sys.country : undefined,
    queryKey,
    tempC,
    description,
    iconCode,
    iconUrl,
  };
}

function mapForecastList(list: unknown[]): WeatherBundle['forecast48h'] {
  const out: WeatherBundle['forecast48h'] = [];
  for (let i = 0; i < Math.min(FORECAST_STEPS, list.length); i++) {
    const item = list[i] as Record<string, unknown>;
    const dt = typeof item.dt === 'number' ? item.dt : 0;
    const main = item.main as { temp?: number } | undefined;
    const weatherArr = item.weather as Array<{ description?: string; icon?: string }> | undefined;
    const w0 = weatherArr?.[0];
    out.push({
      dt,
      tempC: typeof main?.temp === 'number' ? main.temp : NaN,
      description: typeof w0?.description === 'string' ? w0.description : '',
      iconCode: typeof w0?.icon === 'string' ? w0.icon : '01d',
      iconUrl: `https://openweathermap.org/img/wn/${typeof w0?.icon === 'string' ? w0.icon : '01d'}@2x.png`,
    });
  }
  return out;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
