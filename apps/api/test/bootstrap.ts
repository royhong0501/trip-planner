/**
 * Build a Nest test app that mirrors `main.ts` middleware (helmet/cors/cookieParser/body),
 * but with PrismaService and the two ioredis clients replaced.
 *
 * Each spec passes a partial set of overrides — typically the prisma mock returns
 * fixture data via `mockDeep<PrismaClient>()`.
 */
import 'reflect-metadata';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@prisma/client';
import RedisMock from 'ioredis-mock';
import type { Redis as RedisClient } from 'ioredis';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG } from '../src/config/config.module.js';
import { parseEnv } from '../src/config/env.schema.js';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';
import { BULL_CONNECTION, REDIS_CLIENT } from '../src/modules/redis/redis.constants.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';

export interface BootstrappedApp {
  app: INestApplication;
  module: TestingModule;
  prisma: DeepMockProxy<PrismaClient>;
  redis: RedisClient;
  bullRedis: RedisClient;
}

export async function bootstrapTestApp(): Promise<BootstrappedApp> {
  const prisma = mockDeep<PrismaClient>();
  // ioredis-mock implements the Redis class shape that ioredis exports.
  const redis = new (RedisMock as unknown as new () => RedisClient)();
  const bullRedis = new (RedisMock as unknown as new () => RedisClient)();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(parseEnv())
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(REDIS_CLIENT)
    .useValue(redis)
    .overrideProvider(BULL_CONNECTION)
    .useValue(bullRedis)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(compression());
  app.useGlobalFilters(new HttpExceptionFilter({ isProd: false }));

  await app.init();
  return { app, module: moduleRef, prisma, redis, bullRedis };
}
