import { logger } from '@shared/utils/logger';

// base error class
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    constructor(message: string, statusCode: number, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;

        Error.captureStackTrace(this, this.constructor);
    }
}

// user input validation (400)
export class ValidationError extends AppError {
    public readonly details: any;

    constructor(message: string) {
        super(message, 400);
    }
}
