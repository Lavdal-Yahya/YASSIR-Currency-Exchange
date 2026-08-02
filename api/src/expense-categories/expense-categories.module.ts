import { Module } from '@nestjs/common';
import { ExpenseCategoriesController } from './expense-categories.controller.js';
import { ExpenseCategoriesService } from './expense-categories.service.js';

@Module({
  controllers: [ExpenseCategoriesController],
  providers: [ExpenseCategoriesService],
  exports: [ExpenseCategoriesService],
})
export class ExpenseCategoriesModule {}
