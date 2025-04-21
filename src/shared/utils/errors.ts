import logger from "./logger";

// base app error

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    (Error as any).captureStackTrace(this, this.constructor);
  }
}

// input validation (400)
export class ValidationError extends AppError {
  public readonly details: any;

  constructor(message = "Validation failed", details?: any) {
    super(message, 400, true);
    this.details = details;
  }
}

// auth errors (401)
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized access") {
    super(message, 401, true);
  }
}

// permission errors (403)
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden access") {
    super(message, 403, true);
  }
}

// not found errors (404)
export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, true);
  }
}

// resource conflict errors (409)
export class ConflictError extends AppError {
  constructor(message = "Resource already exists") {
    super(message, 409, true);
  }
}

// external service errors (502)
export class ExternalServiceError extends AppError {
  constructor(message = "External service error") {
    super(message, 502, true);
  }
}

// convert any to AppError
export function handleError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  logger.error("Unhandled error:", { error });

  if (error instanceof Error) {
    return new AppError(error.message, 500, false);
  }

  return new AppError("An unexpected error occurred", 500, false);
}
