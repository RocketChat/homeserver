export interface ApiError {
  error: string;
  message: string;
  requestId?: string;
  details?: any;
  code?: string;
}

export class HomeserverError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'HomeserverError';
  }
}

export class ValidationError extends HomeserverError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends HomeserverError {
  constructor(message: string, details?: any) {
    super(message, 'NOT_FOUND', 404, details);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends HomeserverError {
  constructor(message: string, details?: any) {
    super(message, 'UNAUTHORIZED', 401, details);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends HomeserverError {
  constructor(message: string, details?: any) {
    super(message, 'FORBIDDEN', 403, details);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends HomeserverError {
  constructor(message: string, details?: any) {
    super(message, 'CONFLICT', 409, details);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends HomeserverError {
  constructor(message: string = 'Too many requests', details?: any) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, details);
    this.name = 'RateLimitError';
  }
}