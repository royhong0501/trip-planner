import { Router } from 'express';
import { patchTodosSchema, todoItemSchema } from '@trip-planner/shared-schema';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { applyTodoOp, patchTripTodos } from '../services/trips.js';
import { removeTodoReminder, upsertTodoReminder } from '../services/todos.js';
import type { PatchTodosBody } from '@trip-planner/shared-schema';
import type { TodoItem } from '@trip-planner/shared-types';

export const todosRouter = Router();

// Server-side read-modify-write for trips.todos.
todosRouter.patch(
  '/trips/:tripId/todos',
  requireAdmin,
  validate(patchTodosSchema, 'body'),
  asyncHandler(async (req, res) => {
    const tripId = req.params.tripId as string;
    const body = req.body as PatchTodosBody;

    const next = await patchTripTodos(tripId, (current) => {
      if ('replace' in body) return body.replace;
      return applyTodoOp(current, body.op);
    });

    // Side-effects: keep the reminder table + BullMQ in sync for ops that touch one todo.
    if ('op' in body) {
      const op = body.op;
      if (op.type === 'remove') {
        await removeTodoReminder(op.id);
      } else {
        const affected = findTodo(next, op);
        if (affected) await upsertTodoReminder(tripId, affected);
      }
    }

    res.json(next);
  }),
);

// Write a reminder row for a single todo; typically called alongside a trips.todos patch.
todosRouter.post(
  '/trips/:tripId/todos',
  requireAdmin,
  validate(todoItemSchema, 'body'),
  asyncHandler(async (req, res) => {
    const tripId = req.params.tripId as string;
    const todo = req.body as TodoItem;
    await upsertTodoReminder(tripId, todo);
    res.status(201).json({ ok: true });
  }),
);

todosRouter.delete(
  '/todos/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await removeTodoReminder(req.params.id as string);
    res.status(204).end();
  }),
);

function findTodo(
  list: TodoItem[],
  op: { type: 'add' | 'update' | 'toggle'; todo?: TodoItem; id?: string },
): TodoItem | undefined {
  if (op.type === 'add' && op.todo) return list.find((t) => t.id === op.todo!.id);
  if (op.id) return list.find((t) => t.id === op.id);
  return undefined;
}
