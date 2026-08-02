import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error.js';

export class ExpenseCategoryNotFoundError extends DomainError {
  readonly code = 'expense_category_not_found';
  readonly i18nKey = 'error.expense_category_not_found';
  readonly status = HttpStatus.NOT_FOUND;

  constructor(id: string) {
    super(`expense category not found: ${id}`, { id });
  }
}

export class ExpenseCategoryNameTakenError extends DomainError {
  readonly code = 'expense_category_name_taken';
  readonly i18nKey = 'error.expense_category_name_taken';
  readonly status = HttpStatus.CONFLICT;

  constructor(name: string) {
    super(`expense category name already exists: ${name}`, { name });
  }
}
