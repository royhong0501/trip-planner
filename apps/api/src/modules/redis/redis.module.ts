import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis as IORedis, type Redis as RedisClient } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/config.module.js';
import { BULL_CONNECTION, REDIS_CLIENT } from './redis.constants.js';
import { RedisService } from './redis.service.js';

/**
 * Two ioredis instances, deliberately separate:
 *   REDIS_CLIENT     — generic cache + rate-limit + jwt revocation. enableReadyCheck on.
 *   BULL_CONNECTION  — for BullMQ. Requires maxRetriesPerRequest:null + enableReadyCheck:false.
 *
 * Both close on app shutdown.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): RedisClient => {
        const log = new Logger('Redis');
        const client = new IORedis(config.REDIS_URL, {
          lazyConnect: false,
          enableReadyCheck: true,
        });
        if (config.NODE_ENV !== 'test') {
          client.on('error', (err) => log.error('error', err));
        }
        return client;
      },
    },
    {
      provide: BULL_CONNECTION,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): RedisClient => {
        const log = new Logger('BullRedis');
        const client = new IORedis(config.REDIS_URL, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        });
        client.on('error', (err) => log.error('error', err));
        return client;
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, BULL_CONNECTION, RedisService],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly log = new Logger('RedisModule');

  constructor(
    @Inject(REDIS_CLIENT) private readonly client: RedisClient,
    @Inject(BULL_CONNECTION) private readonly bull: RedisClient,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([
      this.client.quit().catch(() => this.client.disconnect()),
      this.bull.quit().catch(() => this.bull.disconnect()),
    ]).catch((err) => this.log.error('shutdown error', err));
  }
}
