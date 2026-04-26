import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../../config/config.module.js';

/**
 * Replaces the legacy `prisma` singleton in `src/db/client.ts`.
 *
 * For interactive transactions (incl. SELECT ... FOR UPDATE), call
 * `prismaService.$transaction(async (tx) => ...)` directly.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PrismaService');

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      datasources: { db: { url: config.DATABASE_URL } },
      log: ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect().catch((err) => {
      this.logger.error('disconnect error', err);
    });
  }
}
