export interface CurrentWeatherPayload {
  name: string;
  country?: string;
  queryKey: string;
  tempC: number;
  description: string;
  iconCode: string;
  iconUrl: string;
}

export interface ForecastHourItem {
  dt: number;
  tempC: number;
  description: string;
  iconCode: string;
  iconUrl: string;
}

export interface WeatherBundle {
  current: CurrentWeatherPayload;
  /** Next 48 hours, 3-hour steps, 16 entries. */
  forecast48h: ForecastHourItem[];
}

export interface GeoCityHit {
  name: string;
  country: string;
  state?: string;
  lat: number;
  lon: number;
}
