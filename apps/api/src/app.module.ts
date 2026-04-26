import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { Redis as RedisClient } from 'ioredis';
import { AppConfigModule } from './config/config.module.js';
import { parseEnv } from './config/env.schema.js';
import { PrismaModule } from './modules/prisma/prisma.module.js';
import { RedisModule } from './modules/redis/redis.module.js';
import { REDIS_CLIENT } from './modules/redis/redis.constants.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ReminderModule } from './modules/reminder/reminder.module.js';
import { AdminUsersModule } from './modules/admin-users/admin-users.module.js';
import { TripsModule } from './modules/trips/trips.module.js';
import { TodosModule } from './modules/todos/todos.module.js';
import { ParticipantsModule } from './modules/participants/participants.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { HomepageModule } from './modules/homepage/homepage.module.js';
import { WeatherModule } from './modules/weather/weather.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_CLIENT],
      useFactory: (redis: RedisClient) => ({
        // Default bucket for any controller without an explicit @Throttle.
        throttlers: [{ name: 'default', limit: 60, ttl: 60_000 }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    AuthModule,
    ReminderModule.forApi({ embedded: parseEnv().ENABLE_EMBEDDED_WORKER }),
    AdminUsersModule,
    TripsModule,
    TodosModule,
    ParticipantsModule,
    ExpensesModule,
    HomepageModule,
    WeatherModule,
    UploadsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
