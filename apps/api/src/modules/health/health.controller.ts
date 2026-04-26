import { Controller, Get, Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  check() {
    return {
      status: 'ok',
      env: this.config.NODE_ENV,
      time: new Date().toISOString(),
    };
  }
}
