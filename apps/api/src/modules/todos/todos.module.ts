import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module.js';
import { TodosController } from './todos.controller.js';
import { TodosService } from './todos.service.js';

@Module({
  imports: [TripsModule],
  controllers: [TodosController],
  providers: [TodosService],
})
export class TodosModule {}
