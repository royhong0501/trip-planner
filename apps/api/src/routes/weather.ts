import { Router } from 'express';
import { geocodeQuerySchema, weatherQuerySchema } from '@trip-planner/shared-schema';
import { externalProxyLimiter } from '../middleware/rateLimit.js';
import { getValidatedQuery, validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  WeatherApiKeyMissingError,
  fetchWeatherBundle,
  geocodeCity,
} from '../services/weather.js';

export const weatherRouter = Router();

weatherRouter.use(externalProxyLimiter);

weatherRouter.get(
  '/',
  validate(weatherQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { lat, lon, lang, label } = getValidatedQuery<{
      lat: number;
      lon: number;
      lang: string;
      label?: string;
    }>(req);
    try {
      const bundle = await fetchWeatherBundle({ lat, lon, lang, label });
      if (!bundle) {
        res.status(404).json(null);
        return;
      }
      res.json(bundle);
    } catch (err) {
      if (err instanceof WeatherApiKeyMissingError) {
        res.status(503).json({ error: 'weather not configured' });
        return;
      }
      throw err;
    }
  }),
);

weatherRouter.get(
  '/geocode',
  validate(geocodeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { q, limit } = getValidatedQuery<{ q: string; limit: number }>(req);
    try {
      const hits = await geocodeCity(q, limit);
      res.json(hits);
    } catch (err) {
      if (err instanceof WeatherApiKeyMissingError) {
        res.status(503).json({ error: 'weather not configured' });
        return;
      }
      throw err;
    }
  }),
);
