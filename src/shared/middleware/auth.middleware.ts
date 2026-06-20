import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { AppError } from "./errorHandler";
import { Role } from "@prisma/client";

// Extend Express Request type to include user information
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: Role;
      };
    }
  }
}

/**
   * authenticate Middleware
   */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError(401, "Authorization token is missing or malformed", "TOKEN_MISSING");
    }

    const token = authHeader.split(" ")[1];
    
    let decoded: any;
    try {
      decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    } catch (err: any) {
      if (err.name === "TokenExpiredError") {
        throw new AppError(401, "Authorization token has expired", "TOKEN_EXPIRED");
      }
      throw new AppError(401, "Invalid authorization token", "TOKEN_INVALID");
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
    });

    if (!user) {
      throw new AppError(401, "User associated with this token no longer exists", "USER_NOT_FOUND");
    }

    if (user.isSuspended) {
      throw new AppError(403, "Your account has been suspended", "USER_SUSPENDED");
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    next(error);
  }
};

/**
   * requireRole Middleware
   */
export const requireRole = (...allowedRoles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, "User authentication required", "AUTH_REQUIRED"));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError(403, "You do not have permission to perform this action", "FORBIDDEN"));
    }

    next();
  };
};

/**
   * requireActiveSubscription Middleware (Stub for now)
   */
export const requireActiveSubscription = async (req: Request, res: Response, next: NextFunction) => {
  // Skeleton to be updated in Phase 5
  next();
};
