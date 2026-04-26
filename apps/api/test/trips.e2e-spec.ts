import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import express from 'express';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { Test } from '@nestjs/testing';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import RedisMock from 'ioredis-mock';
import type { Redis as RedisClient } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { AppConfigModule } from '../src/config/config.module.js';
import { PrismaModule } from '../src/modules/prisma/prisma.module.js';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';
import { RedisModule } from '../src/modules/redis/redis.module.js';
import { REDIS_CLIENT, BULL_CONNECTION } from '../src/modules/redis/redis.constants.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { TripsModule } from '../src/modules/trips/trips.module.js';
import { ReminderQueueService } from '../src/modules/reminder/reminder.queue.service.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { adminCookie } from './auth.helper.js';

describe('Trips e2e', () => {
  let app: INestApplication;
  let prisma: DeepMockProxy<PrismaClient>;
  const reminderQueue = {
    cancelAllForTrip: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    prisma = mockDeep<PrismaClient>();
    const redis = new (RedisMock as unknown as new () => RedisClient)();

    @Global()
    @Module({
      providers: [{ provide: ReminderQueueService, useValue: reminderQueue }],
      exports: [ReminderQueueService],
    })
    class MockReminderModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PrismaModule,
        RedisModule,
        ThrottlerModule.forRoot({ throttlers: [{ name: 'default', limit: 1000, ttl: 60_000 }] }),
        MockReminderModule,
        AuthModule,
        TripsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      .overrideProvider(BULL_CONNECTION)
      .useValue(redis)
      .compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(cookieParser());
    app.use(express.json({ limit: '10mb' }));
    app.useGlobalFilters(new HttpExceptionFilter({ isProd: false }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/trips returns summary list', async () => {
    prisma.trip.findMany.mockResolvedValue([
      {
        id: 'trip-1',
        title: '東京之旅',
        coverImage: '',
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        category: 'international',
        status: 'planning',
        luggageList: [],
        shoppingList: [],
        createdAt: new Date('2026-04-01T00:00:00Z'),
      } as never,
    ]);

    const res = await request(app.getHttpServer()).get('/api/trips');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].title).toBe('東京之旅');
  });

  it('POST /api/trips requires admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/trips')
      .send(makeTrip());
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('請先登入');
  });

  it('DELETE /api/trips/:id calls cancelAllForTrip after delete', async () => {
    // The service's delete uses prisma.$transaction(async tx => ...). Mock that
    // pattern: invoke the callback with the prisma mock so inner deletes resolve.
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: typeof prisma) => Promise<unknown>)(prisma);
        }
        return undefined;
      },
    );
    prisma.todo.deleteMany.mockResolvedValue({ count: 0 } as never);
    prisma.trip.delete.mockResolvedValue({} as never);

    const res = await request(app.getHttpServer())
      .delete('/api/trips/trip-1')
      .set('Cookie', adminCookie());
    expect(res.status).toBe(204);
    expect(reminderQueue.cancelAllForTrip).toHaveBeenCalledWith('trip-1');
  });
});

function makeTrip() {
  return {
    id: 'trip-x',
    title: 't',
    coverImage: '',
    startDate: '2026-05-01',
    endDate: '2026-05-02',
    category: 'domestic',
    status: 'planning',
    todos: [],
    flights: {
      departure: {
        airline: '',
        flightNumber: '',
        departureTime: '',
        arrivalTime: '',
        departureAirport: '',
        arrivalAirport: '',
        checkedBaggage: 0,
        carryOnBaggage: 0,
      },
      return: {
        airline: '',
        flightNumber: '',
        departureTime: '',
        arrivalTime: '',
        departureAirport: '',
        arrivalAirport: '',
        checkedBaggage: 0,
        carryOnBaggage: 0,
      },
    },
    hotels: [],
    dailyItineraries: [],
    luggageList: [],
    shoppingList: [],
    otherNotes: '',
    weatherCities: [],
  };
}
