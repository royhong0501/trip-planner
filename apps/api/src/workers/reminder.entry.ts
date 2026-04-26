/**
 * Standalone entry for running the reminder worker in its own process:
 *
 *   npm run worker:reminder -w @trip-planner/api
 *
 * Mirrors the legacy `src/queue/reminderWorker.ts`. Uses
 * `NestFactory.createApplicationContext` so we get DI without listening on a port.
 */
import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigModule } from '../config/config.module.js';
import { PrismaModule } from '../modules/prisma/prisma.module.js';
import { RedisModule } from '../modules/redis/redis.module.js';
import { ReminderModule } from '../modules/reminder/reminder.module.js';

@Module({
  imports: [AppConfigModule, PrismaModule, RedisModule, ReminderModule.forWorker()],
})
class ReminderWorkerModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(ReminderWorkerModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  Logger.log('[worker:reminder] started', 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker:reminder] failed to boot', err);
  process.exit(1);
});
