import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { redis } from "../../shared/services/redis";

describe("🔐 Authentication Integration Tests", () => {
  const testPatientEmail = "testpatient@example.com";
  const testPatientPhone = "9876500001";
  
  const testDoctorEmail = "testdoctor@example.com";
  const testDoctorPhone = "9876500002";
  const testDoctorLicense = "TEST-LICENSE-123";

  beforeAll(async () => {
    // Clean up any old test data
    await prisma.userSession.deleteMany({
      where: {
        user: {
          email: { in: [testPatientEmail, testDoctorEmail] },
        },
      },
    });
    
    await prisma.subscription.deleteMany({
      where: {
        user: {
          email: { in: [testPatientEmail, testDoctorEmail] },
        },
      },
    });

    await prisma.patient.deleteMany({
      where: {
        user: {
          email: testPatientEmail,
        },
      },
    });

    await prisma.doctor.deleteMany({
      where: {
        userId: {
          in: (
            await prisma.user.findMany({
              where: { email: testDoctorEmail },
              select: { id: true },
            })
          ).map((u) => u.id),
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: { in: [testPatientEmail, testDoctorEmail] },
      },
    });

    // Clear Redis keys related to test accounts
    await redis.del(`lockout:${testPatientEmail}`);
    await redis.del(`failed_attempts:${testPatientEmail}`);
    await redis.del(`otp:${testPatientEmail}`);
    await redis.del(`otp:${testPatientPhone}`);
  });

  afterAll(async () => {
    // Final DB cleanup
    await prisma.userSession.deleteMany({
      where: {
        user: {
          email: { in: [testPatientEmail, testDoctorEmail] },
        },
      },
    });
    
    await prisma.subscription.deleteMany({
      where: {
        user: {
          email: { in: [testPatientEmail, testDoctorEmail] },
        },
      },
    });

    await prisma.patient.deleteMany({
      where: {
        user: {
          email: testPatientEmail,
        },
      },
    });

    await prisma.doctor.deleteMany({
      where: {
        userId: {
          in: (
            await prisma.user.findMany({
              where: { email: testDoctorEmail },
              select: { id: true },
            })
          ).map((u) => u.id),
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: { in: [testPatientEmail, testDoctorEmail] },
      },
    });

    await prisma.$disconnect();
    await redis.quit();
  });

  describe("POST /api/v1/auth/register", () => {
    it("should register a new patient successfully", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({
          role: "patient",
          fullName: "Test Patient Name",
          email: testPatientEmail,
          phone: testPatientPhone,
          password: "Password@123",
          dob: "1995-04-12",
          gender: "male",
          bloodGroup: "O+",
          height: 180,
          weight: 75,
          emergencyName: "Emergency Name",
          emergencyPhone: "9876543210",
          emergencyRelation: "friend",
          terms: true,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testPatientEmail);
      expect(response.body.data.user.role).toBe("PATIENT");
      expect(response.body.data).toHaveProperty("accessToken");
      expect(response.headers["set-cookie"][0]).toContain("refreshToken");
    }, 15000);

    it("should reject registration with duplicate email", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({
          role: "patient",
          fullName: "Another Test",
          email: testPatientEmail, // Duplicate email
          phone: "9876500003",
          password: "Password@123",
          dob: "1995-04-12",
          gender: "female",
          bloodGroup: "A+",
          emergencyName: "Emergency Name",
          emergencyPhone: "9876543210",
          emergencyRelation: "spouse",
          terms: true,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Email is already registered");
    });

    it("should register a new doctor successfully", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({
          role: "provider",
          fullName: "Dr. Test Doctor",
          email: testDoctorEmail,
          phone: testDoctorPhone,
          password: "Password@123",
          specialisation: "Cardiology",
          licenseNumber: testDoctorLicense,
          experience: 15,
          consultationFee: 600,
          affiliation: "Apollo Hospital",
          terms: true,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testDoctorEmail);
      expect(response.body.data.user.role).toBe("DOCTOR");
      expect(response.body.data).toHaveProperty("accessToken");
    }, 15000);
  });

  describe("POST /api/v1/auth/login (Password Mode)", () => {
    it("should authenticate with valid email and password", async () => {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testPatientEmail,
          password: "Password@123",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testPatientEmail);
      expect(response.body.data).toHaveProperty("accessToken");
    }, 30000);

    it("should return 401 with invalid credentials", async () => {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testPatientEmail,
          password: "WrongPassword@999",
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe("OTP Generation & Validation", () => {
    it("should request and generate an OTP code successfully (Email Mode)", async () => {
      const response = await request(app)
        .post("/api/v1/auth/otp/request")
        .send({
          email: testPatientEmail,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty("otp"); // Expose OTP directly in dev mode
    });

    it("should login successfully with the correct OTP (Email OTP Mode)", async () => {
      // 1. Request OTP
      const otpResponse = await request(app)
        .post("/api/v1/auth/otp/request")
        .send({ email: testPatientEmail });
      
      const generatedOtp = otpResponse.body.otp;

      // 2. Login with OTP
      const loginResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testPatientEmail,
          otp: generatedOtp,
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.data.user.email).toBe(testPatientEmail);
      expect(loginResponse.body.data).toHaveProperty("accessToken");
    });
  });

  describe("Failed Attempts & Account Lockout", () => {
    it("should trigger lockout after 5 failed login attempts", async () => {
      // Attempt 5 failed password logins
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post("/api/v1/auth/login")
          .send({
            email: testPatientEmail,
            password: "WrongPassword",
          });
      }

      // 6th attempt should return a 423 Account Locked response
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testPatientEmail,
          password: "WrongPassword",
        });

      expect(response.status).toBe(423);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("locked");
    }, 45000);
  });
});
