import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminGuard } from '../../common/guards/admin.guard.js';

@Controller('api/homepage-settings')
export class HomepageController {
  constructor(private readonly prisma: PrismaService) {}

  /** Public read — header title / hero slides render for anonymous visitors. */
  @Get(':key')
  async get(@Param('key') key: string) {
    const row = await this.prisma.homepageSetting.findUnique({ where: { key } });
    if (!row) return null;
    return { key: row.key, value: row.value };
  }

  @Patch(':key')
  @UseGuards(AdminGuard)
  async upsert(@Param('key') key: string, @Body() body: { value: unknown }) {
    const row = await this.prisma.homepageSetting.upsert({
      where: { key },
      create: { key, value: body.value as object },
      update: { value: body.value as object, updatedAt: new Date() },
    });
    return { key: row.key, value: row.value };
  }
}
