import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { addParticipantSchema } from '@trip-planner/shared-schema';
import { AdminGuard } from '../../common/guards/admin.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ParticipantsService } from './participants.service.js';

@Controller('api')
export class ParticipantsController {
  constructor(private readonly service: ParticipantsService) {}

  @Get('trips/:tripId/participants')
  list(@Param('tripId') tripId: string) {
    return this.service.list(tripId);
  }

  @Post('trips/:tripId/participants')
  @HttpCode(201)
  @UseGuards(AdminGuard)
  add(
    @Param('tripId') tripId: string,
    @Body(new ZodValidationPipe(addParticipantSchema))
    body: { displayName: string; email?: string | null },
  ) {
    return this.service.add(tripId, body.displayName, body.email ?? null);
  }

  @Delete('participants/:id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async delete(@Param('id') id: string): Promise<void> {
    await this.service.delete(id);
  }
}
