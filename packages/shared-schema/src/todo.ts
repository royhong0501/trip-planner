import { z } from 'zod';
import { todoItemSchema } from './trip.js';

export const addTodoSchema = todoItemSchema;

export const patchTodosOpSchema = z.union([
  z.object({
    type: z.literal('add'),
    todo: todoItemSchema,
  }),
  z.object({
    type: z.literal('update'),
    id: z.string(),
    patch: todoItemSchema.partial(),
  }),
  z.object({
    type: z.literal('toggle'),
    id: z.string(),
    checked: z.boolean(),
  }),
  z.object({
    type: z.literal('remove'),
    id: z.string(),
  }),
]);

/** Accepts either a single op, or a replace command with full todos array. */
export const patchTodosSchema = z.union([
  z.object({ op: patchTodosOpSchema }),
  z.object({ replace: z.array(todoItemSchema) }),
]);

export type PatchTodosBody = z.infer<typeof patchTodosSchema>;
