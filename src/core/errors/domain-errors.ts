export class DomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(message, 400, code);
  }
}

export class AuthenticationError extends DomainError {
  constructor(message = 'Invalid credentials', code = 'AUTHENTICATION_ERROR') {
    super(message, 401, code);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Not found', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

export class RateLimitError extends DomainError {
  public readonly retryAfterMinutes?: number;

  constructor(message = 'Too many requests', retryAfterMinutes?: number) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.retryAfterMinutes = retryAfterMinutes;
  }
}

export class InternalError extends DomainError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR');
  }
}

export class SecurityVerificationError extends DomainError {
  constructor(message = 'Security verification failed', code = 'SECURITY_VERIFICATION_FAILED') {
    super(message, 403, code);
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Resource conflict', code = 'CONFLICT') {
    super(message, 409, code);
  }
}

export class ServiceUnavailableError extends DomainError {
  public readonly retryAfterSeconds?: number;

  constructor(message = 'Service temporarily unavailable', retryAfterSeconds?: number) {
    super(message, 503, 'SERVICE_UNAVAILABLE');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Thrown when a marketplace publish is blocked by a known business condition
 * (e.g. no inventory keys and no buyer wallet credits). This is NOT a system
 * error — it is an expected state that resolves once stock or wallet credits
 * are available. Route handlers should downgrade logging to `warn` for this
 * class so it does not create Sentry error noise.
 */
export class PublishBlockedError extends DomainError {
  constructor(message: string) {
    super(message, 422, 'PUBLISH_BLOCKED');
  }
}
