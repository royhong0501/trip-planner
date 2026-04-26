/**
 * Vitest setup. We don't actually rely on a real DB / Redis in unit-style e2e —
 * each spec composes a TestingModule with mocked PrismaService + ioredis
 * (via ioredis-mock).
 *
 * Required env vars are stubbed here so the env schema parse doesn't blow up
 * when modules read APP_CONFIG.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/test';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-jwt-secret-must-be-at-least-32-chars-long';
process.env.JWT_ACCESS_TTL ||= '3600';
process.env.CORS_ORIGIN ||= 'http://localhost:5173';
process.env.S3_ENDPOINT ||= 'http://localhost:9000';
process.env.S3_REGION ||= 'us-east-1';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.S3_ACCESS_KEY_ID ||= 'test';
process.env.S3_SECRET_ACCESS_KEY ||= 'test';
process.env.S3_PUBLIC_BASE_URL ||= 'http://localhost:9000/test-bucket';
process.env.ENABLE_EMBEDDED_WORKER ||= 'false';
