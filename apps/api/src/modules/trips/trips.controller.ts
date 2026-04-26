import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  createTripSchema,
  updateTripListsSchema,
  updateTripSchema,
} from '@trip-planner/shared-schema';
import type { Trip } from '@trip-planner/shared-types';
import { AdminGuard } from '../../common/guards/admin.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { HttpError } from '../../common/exceptions/http.exception.js';
import { TripsService } from './trips.service.js';
import { ReminderQueueService } from '../reminder/reminder.queue.service.js';

@Controller('api/trips')
export class TripsController {
  private readonly logger = new Logger('TripsController');

  constructor(
    private readonly tripsService: TripsService,
    private readonly reminderQueue: ReminderQueueService,
  ) {}

  @Get()
  list() {
    return this.tripsService.list();
  }

  @Get(':id')
  async getById(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const trip = await this.tripsService.getById(id);
    if (!trip) {
      res.status(404);
      return null;
    }
    return trip;
  }

  @Post()
  @HttpCode(201)
  @UseGuards(AdminGuard)
  @UsePipes(new ZodValidationPipe(createTripSchema))
  create(@Body() body: Trip) {
    return this.tripsService.create(body);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTripSchema)) body: Partial<Trip>,
  ) {
    if (!id) throw HttpError.badRequest('missing :id');
    return this.tripsService.update(id, body);
  }

  @Patch(':id/lists')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async updateLists(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTripListsSchema))
    body: { luggageList: Parameters<TripsService['updateLists']>[1]; shoppingList: Parameters<TripsService['updateLists']>[2] },
  ): Promise<void> {
    await this.tripsService.updateLists(id, body.luggageList, body.shoppingList);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async delete(@Param('id') id: string): Promise<void> {
    await this.tripsService.delete(id);
    await this.reminderQueue.cancelAllForTrip(id).catch((err) => {
      this.logger.error('cancel reminders failed', err as Error);
    });
  }
}
