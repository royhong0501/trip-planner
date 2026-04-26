import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { patchTodosSchema, todoItemSchema } from '@trip-planner/shared-schema';
import type { PatchTodosBody } from '@trip-planner/shared-schema';
import type { TodoItem } from '@trip-planner/shared-types';
import { AdminGuard } from '../../common/guards/admin.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TodosService } from './todos.service.js';
import { TripsService, applyTodoOp } from '../trips/trips.service.js';

@Controller('api')
@UseGuards(AdminGuard)
export class TodosController {
  constructor(
    private readonly todosService: TodosService,
    private readonly tripsService: TripsService,
  ) {}

  /** Server-side read-modify-write for trips.todos. */
  @Patch('trips/:tripId/todos')
  async patch(
    @Param('tripId') tripId: string,
    @Body(new ZodValidationPipe(patchTodosSchema)) body: PatchTodosBody,
  ) {
    const next = await this.tripsService.patchTodos(tripId, (current) => {
      if ('replace' in body) return body.replace;
      return applyTodoOp(current, body.op);
    });

    if ('op' in body) {
      const op = body.op;
      if (op.type === 'remove') {
        await this.todosService.removeReminder(op.id);
      } else {
        const affected = findTodo(next, op);
        if (affected) await this.todosService.upsertReminder(tripId, affected);
      }
    }
    return next;
  }

  /** Write a reminder row for a single todo; typically called alongside a trips.todos patch. */
  @Post('trips/:tripId/todos')
  @HttpCode(201)
  async addReminder(
    @Param('tripId') tripId: string,
    @Body(new ZodValidationPipe(todoItemSchema)) body: TodoItem,
  ) {
    await this.todosService.upsertReminder(tripId, body);
    return { ok: true };
  }

  @Delete('todos/:id')
  @HttpCode(204)
  async deleteReminder(@Param('id') id: string): Promise<void> {
    await this.todosService.removeReminder(id);
  }
}

function findTodo(
  list: TodoItem[],
  op: { type: 'add' | 'update' | 'toggle'; todo?: TodoItem; id?: string },
): TodoItem | undefined {
  if (op.type === 'add' && op.todo) return list.find((t) => t.id === op.todo!.id);
  if (op.id) return list.find((t) => t.id === op.id);
  return undefined;
}
