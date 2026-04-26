import { Module } from '@nestjs/common';
import { WeatherController } from './weather.controller.js';
import { WeatherService } from './weather.service.js';

@Module({
  controllers: [WeatherController],
  providers: [WeatherService],
})
export class WeatherModule {}
