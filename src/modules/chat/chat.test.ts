import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// ─── Mock ioredis globally before any other imports ──────────────────────────
vi.mock("ioredis", () => {
  const store = new Map<string, any>();
  const mockRedisInstance = {
    on: vi.fn(function(event, callback) {
      if (event === "connect") {
        setTimeout(callback, 0);
      }
      return mockRedisInstance;
    }),
    incr: vi.fn(async (key: string) => {
      const val = Number(store.get(key) || 0) + 1;
      store.set(key, val);
      return val;
    }),
    set: vi.fn(async (key: string, val: any) => {
      store.set(key, val);
      return "OK";
    }),
    get: vi.fn(async (key: string) => {
      return store.get(key) || null;
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    expire: vi.fn(async () => 1),
    quit: vi.fn(async () => "OK"),
    ping: vi.fn(async () => "PONG"),
  };

  function MockRedis() {
    return mockRedisInstance;
  }

  return {
    default: MockRedis,
  };
});

// ─── Mock Gemini AI services to run fully offline without latency ───────────
vi.mock("../../shared/services/gemini", () => {
  return {
    generateEmbedding: vi.fn(async () => {
      // 768-dimensional mock unit vector
      const vec = Array(768).fill(0).map(() => Math.random() * 2 - 1);
      const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      return vec.map((v) => v / mag);
    }),
    generateChatStream: vi.fn(async () => {
      return (async function* () {
        yield { text: "This is a mock RAG answer based on your reports." };
        yield { text: " Your vitals are stable." };
      })();
    }),
  };
});

import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { Role } from "@prisma/client";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

describe("💬 AI Chatbot (RAG) & Doctor AI Brief Integration Tests", () => {
  const testPatientEmail = "chatpatient@example.com";
  const testPatientPhone = "9876588881";
  const testDoctorEmail = "chatdoctor@example.com";
  const testDoctorPhone = "9876588882";
  const unlinkedDoctorEmail = "unlinkeddoctor@example.com";

  let patientAccessToken: string;
  let doctorAccessToken: string;
  
  let patientUserId: string | undefined;
  let doctorUserId: string | undefined;
  
  let patientId: string | undefined;
  let doctorId: string | undefined;
  
  let chatSessionId: string;
  let testRecordId: string;

  beforeAll(async () => {
    // 1. Database cleanup
    await prisma.chatMessage.deleteMany({
      where: {
        session: {
          patient: {
            user: { email: testPatientEmail },
          },
        },
      },
    });

    await prisma.chatSession.deleteMany({
      where: {
        patient: {
          user: { email: testPatientEmail },
        },
      },
    });

    await prisma.patientDoctorLink.deleteMany({
      where: {
        OR: [
          { patient: { user: { email: testPatientEmail } } },
          { doctor: { user: { email: testDoctorEmail } } },
        ],
      },
    });

    await prisma.recordAIResult.deleteMany({
      where: {
        record: {
          patient: { user: { email: testPatientEmail } },
        },
      },
    });

    await prisma.medicalRecord.deleteMany({
      where: {
        patient: { user: { email: testPatientEmail } },
      },
    });

    await prisma.subscription.deleteMany({
      where: {
        user: { email: { in: [testPatientEmail, testDoctorEmail, unlinkedDoctorEmail] } },
      },
    });

    await prisma.patient.deleteMany({
      where: { user: { email: testPatientEmail } },
    });

    await prisma.doctor.deleteMany({
      where: { user: { email: { in: [testDoctorEmail, unlinkedDoctorEmail] } } },
    });

    await prisma.user.deleteMany({
      where: { email: { in: [testPatientEmail, testDoctorEmail, unlinkedDoctorEmail] } },
    });

    // 2. Create Patient and Doctor Users
    const patientUser = await prisma.user.create({
      data: {
        email: testPatientEmail,
        passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
        phone: testPatientPhone,
        role: Role.PATIENT,
        isVerified: true,
      },
    });
    patientUserId = patientUser.id;

    const doctorUser = await prisma.user.create({
      data: {
        email: testDoctorEmail,
        passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
        phone: testDoctorPhone,
        role: Role.DOCTOR,
        isVerified: true,
      },
    });
    doctorUserId = doctorUser.id;

    // 3. Create Profiles
    const patient = await prisma.patient.create({
      data: {
        userId: patientUserId,
        fullName: "Chat Test Patient",
        gender: "female",
        bloodGroup: "A+",
      },
    });
    patientId = patient.id;

    const doctor = await prisma.doctor.create({
      data: {
        userId: doctorUserId,
        fullName: "Dr. Chat Test Doctor",
        specialisation: "General Medicine",
        licenceNumber: "LIC-CHAT-999",
        licenceVerified: true,
      },
    });
    doctorId = doctor.id;

    // 4. Create Approved Patient-Doctor Connection Link
    await prisma.patientDoctorLink.create({
      data: {
        patientId,
        doctorId,
        status: "APPROVED",
        initiatedBy: "PATIENT",
      },
    });

    // 5. Create a Mock Medical Record + AI Summary for the AI Patient Brief test
    const record = await prisma.medicalRecord.create({
      data: {
        patientId,
        uploadedById: patientUserId,
        fileName: "lab_report.pdf",
        fileKey: "vault/lab_report.pdf",
        fileSize: 124500,
        mimeType: "application/pdf",
        recordType: "BLOOD_TEST",
        processingStatus: "COMPLETED",
      },
    });
    testRecordId = record.id;

    await prisma.recordAIResult.create({
      data: {
        recordId: testRecordId,
        summaryText: "Your Haemoglobin is healthy, but blood sugar shows elevated glucose levels at 145 mg/dL.",
        clinicalSummary: "Fasting glucose is 145 mg/dL, showing mild hyperglycaemia. Patient exhibits standard lipid levels.",
        extractedRaw: {},
        confidence: 0.95,
        modelVersion: "gemini-1.5-flash",
      },
    });

    // 6. Create Tokens
    patientAccessToken = jwt.sign(
      { sub: patientUserId, role: Role.PATIENT },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "1h" }
    );

    doctorAccessToken = jwt.sign(
      { sub: doctorUserId, role: Role.DOCTOR },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "1h" }
    );
  }, 45000);

  afterAll(async () => {
    // Teardown database changes with checks for undefined values
    if (patientId) {
      await prisma.chatMessage.deleteMany({ where: { session: { patientId } } });
      await prisma.chatSession.deleteMany({ where: { patientId } });
      await prisma.patientDoctorLink.deleteMany({ where: { patientId } });
      await prisma.medicalRecord.deleteMany({ where: { patientId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
    }
    if (testRecordId) {
      await prisma.recordAIResult.deleteMany({ where: { recordId: testRecordId } });
    }
    if (doctorId) {
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
    }
    
    // Clean up any left-over unlinked doctor
    const unlinkedDocUser = await prisma.user.findUnique({ where: { email: unlinkedDoctorEmail } });
    if (unlinkedDocUser) {
      await prisma.doctor.deleteMany({ where: { userId: unlinkedDocUser.id } });
      await prisma.user.delete({ where: { id: unlinkedDocUser.id } });
    }

    const cleanUserIds = [patientUserId, doctorUserId].filter((id): id is string => !!id);
    if (cleanUserIds.length > 0) {
      await prisma.subscription.deleteMany({ where: { userId: { in: cleanUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: cleanUserIds } } });
    }

    await prisma.$disconnect();
  }, 45000);

  describe("💬 Chat Sessions Lifecycle & Management", () => {
    it("should successfully create a new chat session for patient", async () => {
      const response = await request(app)
        .post("/api/v1/chat/sessions")
        .set("Authorization", `Bearer ${patientAccessToken}`)
        .send({ title: "Custom Treatment Plan Discussion" });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe("Custom Treatment Plan Discussion");
      expect(response.body.data.patientId).toBe(patientId);

      chatSessionId = response.body.data.id;
    });

    it("should list chat sessions with preview fields", async () => {
      const response = await request(app)
        .get("/api/v1/chat/sessions")
        .set("Authorization", `Bearer ${patientAccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data[0].id).toBe(chatSessionId);
    });
  });

  describe("📤 SSE Streaming Chat Messages & RAG", () => {
    it("should successfully stream RAG chat answers over SSE", async () => {
      const response = await request(app)
        .post(`/api/v1/chat/sessions/${chatSessionId}/messages`)
        .set("Authorization", `Bearer ${patientAccessToken}`)
        .send({ content: "What are my glucose levels?" });

      // Should return SSE headers
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/event-stream");
      expect(response.text).toContain("data:");
      expect(response.text).toContain("[DONE]");
    });

    it("should list message history logs inside the session", async () => {
      const response = await request(app)
        .get(`/api/v1/chat/sessions/${chatSessionId}/messages`)
        .set("Authorization", `Bearer ${patientAccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Contains both the USER message and the ASSISTANT reply
      expect(response.body.data.length).toBe(2);
      expect(response.body.data[0].role).toBe("USER");
      expect(response.body.data[1].role).toBe("ASSISTANT");
    });
  });

  describe("🚫 Subscription Limit Gating (Rate Limiting)", () => {
    it("should reject message stream if patient exceeds the 30 daily messages limit", async () => {
      const todayStr = new Date().toISOString().split("T")[0];
      const { redis } = await import("../../shared/services/redis");
      
      // Simulate reaching the limit by manually setting 30 in the mock Redis store
      await redis.set(`rate:chat:${patientId}:${todayStr}`, 30);

      const response = await request(app)
        .post(`/api/v1/chat/sessions/${chatSessionId}/messages`)
        .set("Authorization", `Bearer ${patientAccessToken}`)
        .send({ content: "This is message number 31." });

      expect(response.status).toBe(429);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("rate limit reached");
    });
  });

  describe("🧑‍⚕️ Doctor AI Patient Brief Endpoint", () => {
    it("should allow linked doctor to retrieve the structured AI Patient Brief", async () => {
      const response = await request(app)
        .get(`/api/v1/chat/doctor/patients/${patientId}/ai-brief`)
        .set("Authorization", `Bearer ${doctorAccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("brief");
      expect(typeof response.body.data.brief).toBe("string");
    });

    it("should block unlinked doctors from viewing the AI Patient Brief", async () => {
      // Create a temporary unlinked doctor
      const unlinkedUser = await prisma.user.create({
        data: {
          email: unlinkedDoctorEmail,
          role: Role.DOCTOR,
          isVerified: true,
        },
      });

      const unlinkedDoctor = await prisma.doctor.create({
        data: {
          userId: unlinkedUser.id,
          fullName: "Dr. Unlinked Doctor",
          specialisation: "Pediatrics",
          licenceNumber: "LIC-UNLINKED-888",
          licenceVerified: true,
        },
      });

      const unlinkedAccessToken = jwt.sign(
        { sub: unlinkedUser.id, role: Role.DOCTOR },
        env.JWT_ACCESS_SECRET,
        { expiresIn: "1h" }
      );

      const response = await request(app)
        .get(`/api/v1/chat/doctor/patients/${patientId}/ai-brief`)
        .set("Authorization", `Bearer ${unlinkedAccessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);

      // Clean up unlinked doctor
      await prisma.doctor.delete({ where: { id: unlinkedDoctor.id } });
      await prisma.user.delete({ where: { id: unlinkedUser.id } });
    });
  });
}, 45000); // 45s timeout for the entire describe suite
