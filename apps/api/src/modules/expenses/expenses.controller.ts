import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { createExpenseSchema, updateExpenseSchema } from '@trip-planner/shared-schema';
import { AdminGuard } from '../../common/guards/admin.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ExpensesService } from './expenses.service.js';

@Controller('api')
export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}

  @Get('trips/:tripId/expenses')
  list(@Param('tripId') tripId: string) {
    return this.service.listByTrip(tripId);
  }

  @Post('expenses')
  @HttpCode(201)
  @UseGuards(AdminGuard)
  create(
    @Body(new ZodValidationPipe(createExpenseSchema))
    body: Parameters<ExpensesService['createWithSplits']>[0] & {
      splits: Parameters<ExpensesService['createWithSplits']>[1];
    },
  ) {
    const { splits, ...rest } = body;
    return this.service.createWithSplits(rest, splits);
  }

  @Patch('expenses/:id')
  @UseGuards(AdminGuard)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateExpenseSchema))
    body: Parameters<ExpensesService['update']>[1],
  ) {
    return this.service.update(id, body);
  }

  @Delete('expenses/:id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async delete(@Param('id') id: string): Promise<void> {
    await this.service.delete(id);
  }
}
