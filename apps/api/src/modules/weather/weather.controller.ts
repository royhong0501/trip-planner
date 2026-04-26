import {
  Controller,
  Get,
  HttpStatus,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { geocodeQuerySchema, weatherQuerySchema } from '@trip-planner/shared-schema';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { WeatherApiKeyMissingError, WeatherService } from './weather.service.js';

/** Replaces the legacy `externalProxyLimiter` (60 req/60s by IP). */
@Controller('api/weather')
@UseGuards(ThrottlerGuard)
@Throttle({ external: { limit: 60, ttl: 60_000 } })
export class WeatherController {
  constructor(private readonly service: WeatherService) {}

  @Get()
  async get(
    @Query(new ZodValidationPipe(weatherQuerySchema))
    query: { lat: number; lon: number; lang: string; label?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const bundle = await this.service.fetchBundle(query);
      if (!bundle) {
        res.status(HttpStatus.NOT_FOUND);
        return null;
      }
      return bundle;
    } catch (err) {
      if (err instanceof WeatherApiKeyMissingError) {
        throw new ServiceUnavailableException({ error: 'weather not configured' });
      }
      throw err;
    }
  }

  @Get('geocode')
  async geocode(
    @Query(new ZodValidationPipe(geocodeQuerySchema))
    query: { q: string; limit: number },
  ) {
    try {
      return await this.service.geocode(query.q, query.limit);
    } catch (err) {
      if (err instanceof WeatherApiKeyMissingError) {
        throw new ServiceUnavailableException({ error: 'weather not configured' });
      }
      throw err;
    }
  }
}
