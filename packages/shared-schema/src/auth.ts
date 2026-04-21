import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const createAdminUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const updateAdminUserPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8).max(200),
});
