import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error.js';

export class ContactNotFoundError extends DomainError {
  readonly code = 'contact_not_found';
  readonly i18nKey = 'error.contact_not_found';
  readonly status = HttpStatus.NOT_FOUND;

  constructor(contactId: string) {
    super(`contact not found: ${contactId}`, { id: contactId });
  }
}

// Duplicate phone is a warning, not a block (spec §10.3). The service
// throws this on the first POST with the existing row attached; the
// frontend renders a confirm dialog and retries with confirmDuplicate:
// true, which bypasses the check entirely.
export class DuplicateContactPhoneError extends DomainError {
  readonly code = 'duplicate_phone';
  readonly i18nKey = 'error.duplicate_phone';
  readonly status = HttpStatus.CONFLICT;

  constructor(phone: string, existing: { id: string; name: string }) {
    super(`contact phone already used: ${phone}`, { phone, existing });
  }
}

// Contact must be at least one of customer/supplier — mirrors the DB
// CHECK constraint (contact_role_present_check). The DTO should catch
// this first; this error exists for the update flow that could otherwise
// flip both flags off in a single PATCH.
export class ContactRoleRequiredError extends DomainError {
  readonly code = 'contact_role_required';
  readonly i18nKey = 'error.contact_role_required';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('a contact must be a customer, a supplier, or both');
  }
}
