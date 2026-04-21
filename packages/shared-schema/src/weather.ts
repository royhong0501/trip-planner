import { z } from 'zod';

export const weatherQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  lang: z.string().min(2).max(10).default('zh_tw'),
  /** Optional cache label; only used in Redis key to group equivalent requests. */
  label: z.string().max(200).optional(),
});

export const geocodeQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});
