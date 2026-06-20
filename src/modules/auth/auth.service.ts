import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../../config/prisma";
import { redis } from "../../shared/services/redis";
import { env } from "../../config/env";
import { AppError } from "../../shared/middleware/errorHandler";
import { logger } from "../../config/logger";
import { Role } from "@prisma/client";
import { sendOtpEmail } from "../../shared/services/email.service";

export class AuthService {
  /**
   * Register a new Patient
   */
  static async registerPatient(data: any) {
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new AppError(400, "Email is already registered", "EMAIL_EXISTS");
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const phoneClean = data.phone.replace(/\s+/g, "");

    // Verify registration OTP flags
    if (env.NODE_ENV !== "test") {
      const emailVerified = await redis.get(`verified:email:${data.email}`);
      const phoneVerified = await redis.get(`verified:phone:${phoneClean}`);

      if (emailVerified !== "true") {
        throw new AppError(400, "Email address has not been OTP-verified", "EMAIL_UNVERIFIED");
      }
      if (phoneVerified !== "true") {
        throw new AppError(400, "Phone number has not been OTP-verified", "PHONE_UNVERIFIED");
      }
    }

    // Split allergies string by commas and filter out empty values
    const allergiesList = data.allergies
      ? data.allergies
          .split(",")
          .map((a: string) => a.trim())
          .filter(Boolean)
      : [];

    // Medications stored as JSON
    const medicationsData = data.medications ? { text: data.medications } : null;

    // Emergency Contact JSON
    const emergencyContact = {
      name: data.emergencyName,
      phone: data.emergencyPhone.replace(/\s+/g, ""),
      relation: data.emergencyRelation,
    };

    // Insurance Info JSON
    const insuranceInfo = data.insuranceProvider
      ? {
          provider: data.insuranceProvider,
          policyNumber: data.policyNumber,
        }
      : null;

    return await prisma.$transaction(async (tx) => {
      // 1. Create User
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          phone: phoneClean,
          role: Role.PATIENT,
          isVerified: true, // Auto-verify in dev mode
        },
      });

      // 2. Create Patient Profile
      const patient = await tx.patient.create({
        data: {
          userId: user.id,
          fullName: data.fullName,
          dateOfBirth: data.dob,
          gender: data.gender,
          bloodGroup: data.bloodGroup,
          heightCm: data.height,
          weightKg: data.weight,
          allergies: allergiesList,
          currentMeds: medicationsData as any,
          emergencyContact: emergencyContact as any,
          insuranceInfo: insuranceInfo as any,
        },
      });

      // 3. Create Free Subscription
      await tx.subscription.create({
        data: {
          userId: user.id,
          plan: "FREE",
          billingCycle: "MONTHLY",
          status: "ACTIVE",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });

      if (env.NODE_ENV !== "test") {
        await redis.del(`verified:email:${data.email}`);
        await redis.del(`verified:phone:${phoneClean}`);
      }

      return { user, patient };
    });
  }

  /**
   * Register a new Doctor
   */
  static async registerDoctor(data: any) {
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new AppError(400, "Email is already registered", "EMAIL_EXISTS");
    }

    const existingLicense = await prisma.doctor.findUnique({
      where: { licenceNumber: data.licenseNumber },
    });

    if (existingLicense) {
      throw new AppError(400, "Licence number is already registered", "LICENSE_EXISTS");
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const phoneClean = data.phone.replace(/\s+/g, "");

    // Verify registration OTP flags
    if (env.NODE_ENV !== "test") {
      const emailVerified = await redis.get(`verified:email:${data.email}`);
      const phoneVerified = await redis.get(`verified:phone:${phoneClean}`);

      if (emailVerified !== "true") {
        throw new AppError(400, "Email address has not been OTP-verified", "EMAIL_UNVERIFIED");
      }
      if (phoneVerified !== "true") {
        throw new AppError(400, "Phone number has not been OTP-verified", "PHONE_UNVERIFIED");
      }
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Create User
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          phone: phoneClean,
          role: Role.DOCTOR,
          isVerified: false, // Doctors require admin review
        },
      });

      // 2. Create Doctor Profile
      const doctor = await tx.doctor.create({
        data: {
          userId: user.id,
          fullName: data.fullName,
          specialisation: data.specialisation,
          licenceNumber: data.licenseNumber,
          licenceVerified: false,
          consultationFee: data.consultationFee,
          bio: data.affiliation ? `Affiliation: ${data.affiliation}` : null,
        },
      });

      // 3. Create Doctor Starter Subscription
      await tx.subscription.create({
        data: {
          userId: user.id,
          plan: "DOCTOR_STARTER",
          billingCycle: "MONTHLY",
          status: "ACTIVE",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });

      if (env.NODE_ENV !== "test") {
        await redis.del(`verified:email:${data.email}`);
        await redis.del(`verified:phone:${phoneClean}`);
      }

      return { user, doctor };
    });
  }

  /**
   * Check Lockout Status
   */
  static async checkLockout(emailOrPhone: string) {
    const isLocked = await redis.get(`lockout:${emailOrPhone}`);
    if (isLocked) {
      throw new AppError(
        423,
        "Account is temporarily locked due to multiple failed login attempts. Try again in 15 minutes.",
        "ACCOUNT_LOCKED"
      );
    }
  }

  /**
   * Handle Failed Login Attempts
   */
  static async handleFailedAttempt(emailOrPhone: string) {
    const attempts = await redis.incr(`failed_attempts:${emailOrPhone}`);
    if (attempts === 1) {
      await redis.expire(`failed_attempts:${emailOrPhone}`, 900); // 15m window
    }

    if (attempts >= 5) {
      await redis.set(`lockout:${emailOrPhone}`, "locked", "EX", 900); // 15m lockout
      await redis.del(`failed_attempts:${emailOrPhone}`);
      logger.warn(`🔒 Account locked out: ${emailOrPhone}`);
      throw new AppError(
        423,
        "Too many failed attempts. Your account has been locked for 15 minutes.",
        "ACCOUNT_LOCKED"
      );
    }
  }

  /**
   * Reset Failed Attempt Count
   */
  static async resetFailedAttempts(emailOrPhone: string) {
    await redis.del(`failed_attempts:${emailOrPhone}`);
  }

  /**
   * Generate 6-digit OTP
   */
  static async generateOtp(emailOrPhone: string): Promise<string> {
    const otp = crypto.randomInt(100000, 999999).toString();
    await redis.set(`otp:${emailOrPhone}`, otp, "EX", 300);

    const isEmail = emailOrPhone.includes("@");
    if (isEmail && env.NODE_ENV === "production") {
      await sendOtpEmail(emailOrPhone, otp, "login");
    } else {
      logger.info(`📨 [OTP] ${emailOrPhone} → ${otp}`);
    }
    return otp;
  }

  /**
   * Verify OTP
   */
  static async verifyOtp(emailOrPhone: string, inputOtp: string): Promise<boolean> {
    const cachedOtp = await redis.get(`otp:${emailOrPhone}`);
    if (!cachedOtp) return false;

    if (cachedOtp === inputOtp) {
      await redis.del(`otp:${emailOrPhone}`); // Consume OTP
      return true;
    }

    return false;
  }

  /**
   * Generate 6-digit OTP for Signup
   */
  static async generateRegisterOtp(type: "email" | "phone", value: string): Promise<string> {
    // 1. Check if already exists in DB
    if (type === "email") {
      const existingUser = await prisma.user.findUnique({ where: { email: value } });
      if (existingUser) {
        throw new AppError(400, "Email is already registered", "EMAIL_EXISTS");
      }
    } else if (type === "phone") {
      const cleanPhone = value.replace(/\s+/g, "");
      const existingUser = await prisma.user.findFirst({ where: { phone: cleanPhone } });
      if (existingUser) {
        throw new AppError(400, "Phone number is already registered", "PHONE_EXISTS");
      }
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    await redis.set(`reg_otp:${type}:${value}`, otp, "EX", 300);

    if (type === "email" && env.NODE_ENV === "production") {
      await sendOtpEmail(value, otp, "signup");
    } else {
      logger.info(`📨 [OTP SIGNUP] ${type} ${value} → ${otp}`);
    }
    return otp;
  }

  /**
   * Verify OTP for Signup
   */
  static async verifyRegisterOtp(type: "email" | "phone", value: string, inputOtp: string): Promise<boolean> {
    const cachedOtp = await redis.get(`reg_otp:${type}:${value}`);
    if (!cachedOtp) return false;

    if (cachedOtp === inputOtp) {
      await redis.del(`reg_otp:${type}:${value}`); // Consume OTP
      // Mark as verified in Redis for 30 minutes
      await redis.set(`verified:${type}:${value}`, "true", "EX", 1800);
      return true;
    }

    return false;
  }

  /**
   * Password Login
   */
  static async loginWithPassword(email: string, password: string) {
    await this.checkLockout(email);

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        patient: true,
        doctor: true,
      },
    });

    if (!user || !user.passwordHash) {
      await this.handleFailedAttempt(email);
      throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    if (user.isSuspended) {
      throw new AppError(403, "Your account has been suspended", "USER_SUSPENDED");
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await this.handleFailedAttempt(email);
      throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    await this.resetFailedAttempts(email);
    return user;
  }

  /**
   * OTP Login (Find User by email or phone)
   */
  static async loginWithOtp(emailOrPhone: string) {
    await this.checkLockout(emailOrPhone);

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: emailOrPhone }, { phone: emailOrPhone.replace(/\s+/g, "") }],
      },
      include: {
        patient: true,
        doctor: true,
      },
    });

    if (!user) {
      throw new AppError(404, "No account found with this email/phone number", "USER_NOT_FOUND");
    }

    if (user.isSuspended) {
      throw new AppError(403, "Your account has been suspended", "USER_SUSPENDED");
    }

    await this.resetFailedAttempts(emailOrPhone);
    return user;
  }

  /**
   * Generate Session Tokens
   */
  static async generateTokens(user: any, deviceInfo?: string, ipAddress?: string) {
    // 1. Sign HS256 Access Token
    const accessToken = jwt.sign(
      { sub: user.id, role: user.role },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN as any }
    );

    // 2. Generate opaque Refresh Token
    const refreshToken = crypto.randomBytes(32).toString("hex");

    // 3. Cache Refresh Token in Redis (expires in 7 days)
    const redisExpirySeconds = 7 * 24 * 60 * 60; // 7 days
    const sessionPayload = {
      userId: user.id,
      role: user.role,
    };
    await redis.set(
      `rt:${refreshToken}`,
      JSON.stringify(sessionPayload),
      "EX",
      redisExpirySeconds
    );

    // 4. Save UserSession in Postgres
    await prisma.userSession.create({
      data: {
        userId: user.id,
        refreshToken,
        deviceInfo: deviceInfo ?? null,
        ipAddress: ipAddress ?? null,
        expiresAt: new Date(Date.now() + redisExpirySeconds * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * Rotate Tokens (Refresh Flow)
   */
  static async rotateTokens(oldRefreshToken: string, deviceInfo?: string, ipAddress?: string) {
    const cachedSessionStr = await redis.get(`rt:${oldRefreshToken}`);

    if (!cachedSessionStr) {
      // Reused Refresh Token/Attacker Detection
      const dbSession = await prisma.userSession.findUnique({
        where: { refreshToken: oldRefreshToken },
      });

      if (dbSession) {
        logger.warn(`⚠️ Possible token reuse attack detected for User: ${dbSession.userId}`);
        // Revoke all sessions for this user to be safe
        await prisma.userSession.updateMany({
          where: { userId: dbSession.userId },
          data: { revokedAt: new Date() },
        });

        // Search Redis for any rt sessions of this user and delete them (out of scope for simple check)
      }

      throw new AppError(401, "Invalid or expired session token", "INVALID_SESSION");
    }

    const { userId, role } = JSON.parse(cachedSessionStr);

    // Get the user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.isSuspended) {
      throw new AppError(401, "Session owner is suspended or deleted", "INVALID_SESSION");
    }

    // 1. Invalidate old token in Redis and DB
    await redis.del(`rt:${oldRefreshToken}`);
    await prisma.userSession.update({
      where: { refreshToken: oldRefreshToken },
      data: { revokedAt: new Date() },
    });

    // 2. Generate and return new tokens
    return await this.generateTokens(user, deviceInfo, ipAddress);
  }

  /**
   * Revoke Session
   */
  static async logout(refreshToken: string) {
    await redis.del(`rt:${refreshToken}`);
    await prisma.userSession.updateMany({
      where: { refreshToken },
      data: { revokedAt: new Date() },
    });
  }
}
