import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { Redis as RedisClient } from 'ioredis';
import { RedisModule } from '../redis/redis.module.js';
import { BULL_CONNECTION } from '../redis/redis.constants.js';
import { REMINDER_QUEUE_NAME } from './reminder.constants.js';
import { ReminderQueueService } from './reminder.queue.service.js';
import { ReminderProcessor } from './reminder.processor.js';

const bullRoot = BullModule.forRootAsync({
  imports: [RedisModule],
  inject: [BULL_CONNECTION],
  useFactory: (connection: RedisClient) => ({ connection }),
});

const bullQueue = BullModule.registerQueue({ name: REMINDER_QUEUE_NAME });

/**
 * Marked @Global so TripsService / TodosService can inject ReminderQueueService
 * without each feature module re-importing ReminderModule.
 *
 *   forApi({ embedded })  — Queue producer + (optional) embedded Processor
 *                           when ENABLE_EMBEDDED_WORKER=true
 *   forWorker()           — Queue + Processor for `workers/reminder.entry.ts`
 */
@Global()
@Module({})
export class ReminderModule {
  static forApi(opts: { embedded: boolean }): DynamicModule {
    const providers: Provider[] = [ReminderQueueService];
    if (opts.embedded) providers.push(ReminderProcessor);
    return {
      global: true,
      module: ReminderModule,
      imports: [bullRoot, bullQueue],
      providers,
      exports: [ReminderQueueService],
    };
  }

  static forWorker(): DynamicModule {
    return {
      global: true,
      module: ReminderModule,
      imports: [bullRoot, bullQueue],
      providers: [ReminderQueueService, ReminderProcessor],
      exports: [ReminderQueueService],
    };
  }
}
