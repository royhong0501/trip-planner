import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import express from 'express';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { ACCESS_COOKIE_NAME } from '../src/modules/auth/auth.service.js';

describe('Auth e2e', () => {
  let app: INestApplication;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeAll(async () => {
    prisma = mockDeep<PrismaClient>();
    const redis = new (RedisMock as unknown as new () => RedisClient)();

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PrismaModule,
        RedisModule,
        ThrottlerModule.forRoot({ throttlers: [{ name: 'default', limit: 1000, ttl: 60_000 }] }),
        AuthModule,
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
    app.use(express.json());
    app.useGlobalFilters(new HttpExceptionFilter({ isProd: false }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('login → me → logout happy path', async () => {
    const passwordHash = await bcrypt.hash('correct horse battery staple', 12);
    prisma.adminUser.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      passwordHash,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // login
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'correct horse battery staple' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.email).toBe('admin@example.com');
    const cookie = loginRes.headers['set-cookie'];
    expect(cookie).toBeDefined();
    const cookieStr = Array.isArray(cookie) ? cookie.join('; ') : (cookie ?? '');
    expect(cookieStr).toContain(ACCESS_COOKIE_NAME);

    // me
    const meRes = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookieStr);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe('admin@example.com');

    // logout
    const logoutRes = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookieStr);
    expect(logoutRes.status).toBe(204);
  });

  it('rejects bad password with 401 and Chinese message', async () => {
    const passwordHash = await bcrypt.hash('correct password', 12);
    prisma.adminUser.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('帳號或密碼錯誤');
  });

  it('me without cookie returns 401 with 請先登入', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('請先登入');
  });
});
