import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error.js';

// P6 · reversal errors. Every reversal endpoint is idempotent — a second
// attempt against an already-reversed row returns 422 rather than a
// silent success (would mask a bug in the caller). See phase-6.md §6.6.

// Attempt to reverse a row that is already REVERSED.
export class AlreadyReversedError extends DomainError {
  readonly code = 'already_reversed';
  readonly i18nKey = 'error.already_reversed';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: { entityType: string; entityId: string }) {
    super(`${details.entityType} ${details.entityId} is already REVERSED`, details);
  }
}

// Reversal requires a non-empty reason (spec §16.4 + phase-6.md §4).
// Enforced above the DB CHECK so operators see a friendly 422 rather
// than a constraint violation on retry.
export class ReversalReasonRequiredError extends DomainError {
  readonly code = 'reversal_reason_required';
  readonly i18nKey = 'error.reversal_reason_required';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(details: { entityType: string; entityId: string }) {
    super(`reason is required to reverse ${details.entityType} ${details.entityId}`, details);
  }
}

// The row to reverse could not be found. 404, not 422 — a missing row
// is a client bug, not a business-rule violation.
export class ReversalTargetNotFoundError extends DomainError {
  readonly code = 'reversal_target_not_found';
  readonly i18nKey = 'error.reversal_target_not_found';
  readonly status = HttpStatus.NOT_FOUND;

  constructor(details: { entityType: string; entityId: string }) {
    super(`${details.entityType} ${details.entityId} not found`, details);
  }
}
