import 'dotenv/config';
import { z } from 'zod';

/**
 * Single source of truth for env vars. Same shape as the legacy `src/config/env.ts`,
 * with `ENABLE_EMBEDDED_WORKER` added for the Nest BullMQ split.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(60 * 60),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

  CORS_ORIGIN: z.string().min(1),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z.coerce.boolean().default(false),

  ADMIN_SEED_EMAIL: z.string().email().optional(),
  ADMIN_SEED_PASSWORD: z.string().min(8).optional(),

  OPENWEATHER_API_KEY: z.string().optional(),

  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().email().optional(),
  REMINDER_FALLBACK_EMAIL: z.string().email().optional(),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_PUBLIC_BASE_URL: z.string().url(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  /** When true (default in dev/single-process), the API process also runs the BullMQ Worker. */
  ENABLE_EMBEDDED_WORKER: z.coerce.boolean().default(true),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const messages = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(
      `Invalid environment variables:\n${messages.join('\n')}\n\nSee .env.example for the complete list.`,
    );
  }
  return result.data;
}

export const isProd = (env: Env): boolean => env.NODE_ENV === 'production';
export const isDev = (env: Env): boolean => env.NODE_ENV === 'development';
export const isTest = (env: Env): boolean => env.NODE_ENV === 'test';
