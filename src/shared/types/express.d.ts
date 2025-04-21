// extend express request interface
import "express";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      id?: string;
      isAdmin?: boolean;
    }
  }
}




