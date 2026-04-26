import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppConfigModule } from '../src/config/config.module.js';
import { HealthModule } from '../src/modules/health/health.module.js';

/**
 * Module-scoped e2e: bypasses AppModule (which would init Throttler/Bull)
 * to keep tests deterministic and fast.
 */
describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, HealthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok + env + iso time', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.env).toBe('test');
    expect(typeof res.body.time).toBe('string');
  });
});
