import { Module } from '@nestjs/common';
import { HomepageController } from './homepage.controller.js';

@Module({
  controllers: [HomepageController],
})
export class HomepageModule {}
