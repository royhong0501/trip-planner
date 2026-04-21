import { z } from 'zod';

export const homepageSettingKeySchema = z.enum(['site_name', 'hero_slides', 'video_intro']);

export const homepageSettingPatchSchema = z.object({
  key: homepageSettingKeySchema,
  value: z.unknown(),
});

export const presignUploadSchema = z.object({
  kind: z.enum(['cover', 'hero', 'activity', 'homepage']).default('cover'),
  contentType: z.string().min(1).max(100),
  /** bytes */
  size: z.number().int().positive().max(20 * 1024 * 1024),
});
