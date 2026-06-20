import { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service";
import {
  registerPatientSchema,
  registerDoctorSchema,
  loginSchema,
  requestOtpSchema,
  requestRegisterOtpSchema,
  verifyRegisterOtpSchema,
} from "./auth.schema";
import { AppError } from "../../shared/middleware/errorHandler";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";

const setRefreshTokenCookie = (res: Response, token: string) => {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

export class AuthController {
  /**
   * Register Patient or Doctor
   */
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = req.body;

      if (!role) {
        throw new AppError(400, "Role is required (patient or provider)");
      }

      let result;
      if (role.toLowerCase() === "patient") {
        const validated = registerPatientSchema.parse(req.body);
        result = await AuthService.registerPatient(validated);
      } else if (role.toLowerCase() === "provider" || role.toLowerCase() === "doctor") {
        const validated = registerDoctorSchema.parse(req.body);
        result = await AuthService.registerDoctor(validated);
      } else {
        throw new AppError(400, "Invalid role. Must be 'patient' or 'provider'");
      }

      // Automatically log in user after successful registration
      const ipAddress = req.ip || req.socket.remoteAddress;
      const deviceInfo = req.headers["user-agent"];
      const tokens = await AuthService.generateTokens(result.user, deviceInfo, ipAddress);

      setRefreshTokenCookie(res, tokens.refreshToken);

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            phone: result.user.phone,
            role: result.user.role,
          },
          accessToken: tokens.accessToken,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request OTP (for login)
   */
  static async requestOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = requestOtpSchema.parse(req.body);
      const emailOrPhone = validated.email || validated.phone;

      if (!emailOrPhone) {
        throw new AppError(400, "Email or Phone is required");
      }

      // Check if user exists before generating OTP
      const user = await prisma.user.findFirst({
        where: {
          OR: [{ email: emailOrPhone }, { phone: emailOrPhone.replace(/\s+/g, "") }],
        },
      });

      if (!user) {
        throw new AppError(404, "No account found with this email/phone number", "USER_NOT_FOUND");
      }

      const otp = await AuthService.generateOtp(emailOrPhone);

      // In development mode, return OTP in API response for easy testing
      const responseData: any = {
        success: true,
        message: "OTP sent successfully",
      };

      // Only expose OTP outside production (Resend handles delivery in production)
      if (env.NODE_ENV !== "production") {
        responseData.otp = otp;
      }

      res.status(200).json(responseData);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request OTP for Signup Registration
   */
  static async requestRegisterOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = requestRegisterOtpSchema.parse(req.body);
      const otp = await AuthService.generateRegisterOtp(validated.type, validated.value);

      const responseData: any = {
        success: true,
        message: `${validated.type === "email" ? "Email" : "Phone"} OTP sent successfully`,
      };

      // Only expose OTP outside production (Resend handles delivery in production)
      if (env.NODE_ENV !== "production") {
        responseData.otp = otp;
      }

      res.status(200).json(responseData);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify OTP for Signup Registration
   */
  static async verifyRegisterOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = verifyRegisterOtpSchema.parse(req.body);
      const isValid = await AuthService.verifyRegisterOtp(validated.type, validated.value, validated.otp);

      if (!isValid) {
        throw new AppError(400, "Invalid or expired OTP code", "INVALID_OTP");
      }

      res.status(200).json({
        success: true,
        message: `${validated.type === "email" ? "Email" : "Phone"} verified successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Login (supports Password, Email OTP, or Phone OTP)
   */
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = loginSchema.parse(req.body);
      const ipAddress = req.ip || req.socket.remoteAddress;
      const deviceInfo = req.headers["user-agent"];

      let user;

      if (validated.password) {
        // 1. Password Auth (Email only)
        if (!validated.email) {
          throw new AppError(400, "Email is required for password login");
        }
        user = await AuthService.loginWithPassword(validated.email, validated.password);
      } else if (validated.otp) {
        // 2. OTP Auth (Email or Phone)
        const emailOrPhone = validated.email || validated.phone;
        if (!emailOrPhone) {
          throw new AppError(400, "Email or phone number is required for OTP login");
        }

        const isOtpValid = await AuthService.verifyOtp(emailOrPhone, validated.otp);
        if (!isOtpValid) {
          await AuthService.handleFailedAttempt(emailOrPhone);
          throw new AppError(401, "Invalid OTP code", "INVALID_OTP");
        }

        user = await AuthService.loginWithOtp(emailOrPhone);
      } else {
        throw new AppError(400, "Provide password or OTP to authenticate");
      }

      // Generate tokens
      const tokens = await AuthService.generateTokens(user, deviceInfo, ipAddress);

      setRefreshTokenCookie(res, tokens.refreshToken);

      res.status(200).json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            phone: user.phone,
            role: user.role,
            patient: user.patient,
            doctor: user.doctor,
          },
          accessToken: tokens.accessToken,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Refresh Token
   */
  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const refreshToken = req.cookies?.refreshToken;

      if (!refreshToken) {
        throw new AppError(401, "No refresh token found", "REFRESH_TOKEN_REQUIRED");
      }

      const ipAddress = req.ip || req.socket.remoteAddress;
      const deviceInfo = req.headers["user-agent"];

      const tokens = await AuthService.rotateTokens(refreshToken, deviceInfo, ipAddress);

      setRefreshTokenCookie(res, tokens.refreshToken);

      res.status(200).json({
        success: true,
        data: {
          accessToken: tokens.accessToken,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Logout
   */
  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const refreshToken = req.cookies?.refreshToken;

      if (refreshToken) {
        await AuthService.logout(refreshToken);
      }

      res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: env.NODE_ENV === "production" ? "none" : "lax",
      });

      res.status(200).json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      next(error);
    }
  }
}
