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
  UsePipes,
} from '@nestjs/common';
import { z } from 'zod';
import {
  createAdminUserSchema,
  updateAdminUserPasswordSchema,
} from '@trip-planner/shared-schema';
import { AdminGuard } from '../../common/guards/admin.guard.js';
import {
  CurrentAdmin,
  type AdminTokenPayload,
} from '../../common/decorators/current-admin.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AdminUsersService } from './admin-users.service.js';

const passwordOnlySchema = updateAdminUserPasswordSchema.pick({ password: true });

@Controller('api/admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(createAdminUserSchema))
  create(@Body() body: { email: string; password: string }) {
    return this.service.create(body.email, body.password);
  }

  @Patch(':userId/password')
  updatePassword(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(passwordOnlySchema))
    body: z.infer<typeof passwordOnlySchema>,
  ) {
    return this.service.updatePassword(userId, body.password);
  }

  @Delete(':userId')
  @HttpCode(204)
  async delete(
    @Param('userId') userId: string,
    @CurrentAdmin() admin: AdminTokenPayload,
  ): Promise<void> {
    await this.service.delete(userId, admin.sub);
  }
}
