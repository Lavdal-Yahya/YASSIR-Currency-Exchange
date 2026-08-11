import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error.js';

export class InactiveExpenseCategoryError extends DomainError {
  readonly code = 'inactive_expense_category';
  readonly i18nKey = 'error.inactive_expense_category';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(id: string) {
    super(`expense category ${id} is inactive`, { id });
  }
}
