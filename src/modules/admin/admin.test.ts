import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

vi.mock("../../shared/services/redis", () => {
  return {
    redis: {
      del: async () => 0,
      set: async () => "OK",
      get: async () => null,
      quit: async () => "OK",
      on: () => {},
    },
  };
});

import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { redis } from "../../shared/services/redis";
import { Role, PlanTier, BillingCycle, PaymentStatus, SubscriptionStatus } from "@prisma/client";
import { AuthService } from "../auth/auth.service";

describe("🛡️ Platform Admin API Integration Tests", () => {
  const adminEmail = "admin.test@medicore.com";
  const patientEmail = "patient.test@medicore.com";
  const newPatientEmail = "patient.crud@medicore.com";

  let adminToken: string;
  let patientToken: string;
  let adminUser: any;
  let patientUser: any;
  let testPayment: any;

  beforeAll(async () => {
    // 1. Clean old test data
    await prisma.userSession.deleteMany({
      where: {
        user: { email: { in: [adminEmail, patientEmail, newPatientEmail] } },
      },
    });

    await prisma.payment.deleteMany({
      where: {
        subscription: {
          user: { email: { in: [adminEmail, patientEmail, newPatientEmail] } },
        },
      },
    });

    await prisma.subscription.deleteMany({
      where: {
        user: { email: { in: [adminEmail, patientEmail, newPatientEmail] } },
      },
    });

    await prisma.patient.deleteMany({
      where: {
        user: { email: { in: [adminEmail, patientEmail, newPatientEmail] } },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: { in: [adminEmail, patientEmail, newPatientEmail] },
      },
    });

    // 2. Create Admin and Standard Patient in DB
    const passwordHash = await AuthService.generateOtp(adminEmail); // Just a hash placeholder
    
    adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        role: Role.PLATFORM_ADMIN,
        isVerified: true,
      },
    });

    patientUser = await prisma.user.create({
      data: {
        email: patientEmail,
        passwordHash,
        role: Role.PATIENT,
        isVerified: true,
        patient: {
          create: {
            fullName: "Telemetry Test Subject",
            state: "Karnataka",
          },
        },
        subscription: {
          create: {
            plan: PlanTier.PRO_1Y,
            billingCycle: BillingCycle.YEARLY,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          },
        },
      },
      include: {
        subscription: true,
      },
    });

    // Create a mock successful payment for patient to test refunds
    testPayment = await prisma.payment.create({
      data: {
        subscriptionId: patientUser.subscription.id,
        amount: 8999,
        status: PaymentStatus.SUCCEEDED,
        provider: "RAZORPAY",
        razorpayOrderId: "order_test_admin_refund",
        providerPaymentId: "pay_test_admin_refund",
        paidAt: new Date(),
      },
    });

    // Generate Bearer tokens
    const adminTokens = await AuthService.generateTokens(adminUser);
    adminToken = adminTokens.accessToken;

    const patientTokens = await AuthService.generateTokens(patientUser);
    patientToken = patientTokens.accessToken;
  }, 30000);

  afterAll(async () => {
    // DB clean up
    await prisma.userSession.deleteMany({
      where: {
        user: { email: { in: [adminEmail, patientEmail, newPatientEmail] } },
      },
    });

    await prisma.payment.deleteMany({
      where: {
        subscription: {
          user: { email: { in: [adminEmail, patientEmail, newPatientEmail] } },
        },
      },
    });

    await prisma.subscription.deleteMany({
      where: {
        user: { email: { in: [adminEmail, patientEmail, newPatientEmail] } },
      },
    });

    await prisma.patient.deleteMany({
      where: {
        user: { email: { in: [adminEmail, patientEmail, newPatientEmail] } },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: { in: [adminEmail, patientEmail, newPatientEmail] },
      },
    });

    await prisma.$disconnect();
    await redis.quit();
  }, 30000);

  describe("🔒 Admin Endpoint Guard Validation", () => {
    it("should reject standard patients with 403 Forbidden", async () => {
      const res = await request(app)
        .get("/api/v1/admin/analytics")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("permission");
    });

    it("should authorize admin accounts successfully", async () => {
      const res = await request(app)
        .get("/api/v1/admin/analytics")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("overview");
    });
  });

  describe("📊 GET /api/v1/admin/analytics", () => {
    it("should return geographic and trends metrics successfully", async () => {
      const res = await request(app)
        .get("/api/v1/admin/analytics")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.overview.totalPatients).toBeGreaterThan(0);
      expect(res.body.data.geographicBreakdown.some((g: any) => g.state === "Karnataka")).toBe(true);
      expect(res.body.data).toHaveProperty("registrationTrend");
      expect(res.body.data).toHaveProperty("planStats");
    });
  });

  describe("📂 Patient CRUD Mutations", () => {
    let createdUserId: string;

    it("should create a patient via POST /api/v1/admin/patients", async () => {
      const res = await request(app)
        .post("/api/v1/admin/patients")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          email: newPatientEmail,
          phone: "9876543222",
          fullName: "New Seeded CRUD patient",
          dob: "1994-08-10",
          gender: "female",
          bloodGroup: "O+",
          state: "Telangana",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(newPatientEmail);
      expect(res.body.data.state).toBe("Telangana");
      
      createdUserId = res.body.data.userId;
    });

    it("should list patients with filtering via GET /api/v1/admin/patients", async () => {
      const res = await request(app)
        .get("/api/v1/admin/patients")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ search: "New Seeded" });

      expect(res.status).toBe(200);
      expect(res.body.data.patients.length).toBeGreaterThan(0);
      expect(res.body.data.patients[0].fullName).toBe("New Seeded CRUD patient");
    });

    it("should update patient details via PUT /api/v1/admin/patients/:id", async () => {
      const res = await request(app)
        .put(`/api/v1/admin/patients/${createdUserId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          fullName: "Updated CRUD Name",
          state: "Delhi",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.fullName).toBe("Updated CRUD Name");
      expect(res.body.data.state).toBe("Delhi");
    });

    it("should toggle suspension locks via POST /api/v1/admin/users/:id/suspend", async () => {
      // 1. Suspend patient
      const res = await request(app)
        .post(`/api/v1/admin/users/${createdUserId}/suspend`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isSuspended).toBe(true);

      // Verify that user is indeed suspended in DB
      const user = await prisma.user.findUnique({ where: { id: createdUserId } });
      expect(user?.isSuspended).toBe(true);

      // 2. Reactivate patient
      const resReactivate = await request(app)
        .post(`/api/v1/admin/users/${createdUserId}/suspend`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(resReactivate.status).toBe(200);
      expect(resReactivate.body.data.isSuspended).toBe(false);
    });

    it("should delete a patient record via DELETE /api/v1/admin/patients/:id", async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/patients/${createdUserId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const user = await prisma.user.findUnique({ where: { id: createdUserId } });
      expect(user).toBeNull();
    });
  });

  describe("💸 Financial Auditing & Refunds", () => {
    it("should query payment ledgers via GET /api/v1/admin/payments", async () => {
      const res = await request(app)
        .get("/api/v1/admin/payments")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.payments.some((p: any) => p.id === testPayment.id)).toBe(true);
    });

    it("should process a refund and downgrade subscription tier via POST /api/v1/admin/payments/:id/refund", async () => {
      const res = await request(app)
        .post(`/api/v1/admin/payments/${testPayment.id}/refund`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("REFUNDED");
      expect(res.body.data.subscription.plan).toBe("FREE");

      // Verify that patient subscription plan in DB was downgraded to FREE
      const sub = await prisma.subscription.findUnique({ where: { userId: patientUser.id } });
      expect(sub?.plan).toBe(PlanTier.FREE);
    });
  });
});
