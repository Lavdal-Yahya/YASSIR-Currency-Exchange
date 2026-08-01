// Re-export shim — the real classes now live under common/errors so
// every domain error inherits from DomainError and is handled by the
// global DomainExceptionFilter (P1-09). Existing imports from
// './errors.js' inside the auth module keep working.
export { InvalidCredentialsError, AccountLockedError } from '../common/errors/auth.errors.js';
