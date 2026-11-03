/**
 * Custom Error Hierarchy for Deck Order
 * Separates fatal domain/validation errors from transient external failures.
 */

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class SpotifyAuthError extends AppError {
  constructor(message, details = null) {
    super(message, 401, 'SPOTIFY_AUTH_ERROR', details);
  }
}

export class EligibilityError extends AppError {
  constructor(message, details = null) {
    super(message, 403, 'SPOTIFY_ELIGIBILITY_ERROR', details);
  }
}

export class QuotaExceededError extends AppError {
  constructor(message, details = null) {
    super(message, 429, 'QUOTA_EXCEEDED_ERROR', details);
  }
}

export class ReconciliationError extends AppError {
  constructor(message, details = null) {
    super(message, 409, 'RECONCILIATION_ERROR', details);
  }
}

export class ProviderTimeoutError extends AppError {
  constructor(message, details = null) {
    super(message, 504, 'PROVIDER_TIMEOUT_ERROR', details);
  }
}
