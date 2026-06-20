import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { Role } from "@prisma/client";
import { redis } from "../../shared/services/redis";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

describe("📂 Medical Records & Patient Profile Integration Tests", () => {
  const testUserEmail = "recordstest@example.com";
  const testUserPhone = "9876599999";
  let accessToken: string;
  let userId: string;
  let patientId: string;
  let uploadedRecordId: string;

  beforeAll(async () => {
    // 1. Clean up old test user
    const oldUser = await prisma.user.findUnique({
      where: { email: testUserEmail },
    });
    if (oldUser) {
      await prisma.userSession.deleteMany({ where: { userId: oldUser.id } });
      await prisma.medicalRecord.deleteMany({ where: { patientId: { in: [oldUser.id] } } });
      await prisma.patient.deleteMany({ where: { userId: oldUser.id } });
      await prisma.user.delete({ where: { id: oldUser.id } });
    }

    // 2. Create User and Patient Profile in database
    const user = await prisma.user.create({
      data: {
        email: testUserEmail,
        passwordHash: "$2a$10$abcdefghijklmnopqrstuv", // dummy hash
        phone: testUserPhone,
        role: Role.PATIENT,
        isVerified: true,
      },
    });
    userId = user.id;

    const patient = await prisma.patient.create({
      data: {
        userId: user.id,
        fullName: "Test Records Patient",
        gender: "male",
        bloodGroup: "O+",
      },
    });
    patientId = patient.id;

    // 3. Generate access token
    accessToken = jwt.sign(
      { sub: user.id, role: user.role },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    // Cleanup database entries
    await prisma.userSession.deleteMany({ where: { userId } });
    await prisma.medicalRecord.deleteMany({ where: { patientId } });
    await prisma.patient.deleteMany({ where: { id: patientId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await redis.quit();
  });

  describe("👤 Patient Profile CRUD", () => {
    it("should retrieve the patient profile successfully", async () => {
      const response = await request(app)
        .get("/api/v1/patient/profile")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.fullName).toBe("Test Records Patient");
      expect(response.body.data.gender).toBe("male");
    });

    it("should update the patient profile successfully", async () => {
      const response = await request(app)
        .put("/api/v1/patient/profile")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          fullName: "Updated Test Name",
          gender: "non-binary",
          bloodGroup: "AB-",
          heightCm: 178,
          weightKg: 72,
          allergies: ["latex", "penicillin"],
          currentMeds: { text: "None" },
          emergencyContact: {
            name: "Emergency Contact",
            phone: "9876543210",
            relation: "spouse",
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.fullName).toBe("Updated Test Name");
      expect(response.body.data.gender).toBe("non-binary");
      expect(response.body.data.bloodGroup).toBe("AB-");
      expect(response.body.data.heightCm).toBe(178);
      expect(response.body.data.weightKg).toBe(72);
      expect(response.body.data.allergies).toContain("latex");
    });
  });

  describe("📤 Document Uploads & S3 Mocking", () => {
    it("should upload a PDF medical report successfully", async () => {
      const testBuffer = Buffer.from("%PDF-1.4 test content");
      const response = await request(app)
        .post("/api/v1/records/upload")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", testBuffer, {
          filename: "test_blood_report.pdf",
          contentType: "application/pdf",
        })
        .field("recordType", "BLOOD_TEST")
        .field("facilityName", "Apollo Diagnostic Centre")
        .field("recordDate", "2026-06-19");

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.fileName).toBe("test_blood_report.pdf");
      expect(response.body.data.recordType).toBe("BLOOD_TEST");
      expect(response.body.data.facilityName).toBe("Apollo Diagnostic Centre");
      expect(response.body.data.processingStatus).toBe("PENDING");

      uploadedRecordId = response.body.data.id;
    }, 15000);

    it("should reject uploading files with unwhitelisted formats", async () => {
      const testBuffer = Buffer.from("hello world plain text");
      const response = await request(app)
        .post("/api/v1/records/upload")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("file", testBuffer, {
          filename: "unsupported.txt",
          contentType: "text/plain",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Invalid file format");
    });
  });

  describe("🔍 Records Queries, Signed URLs & Deletion", () => {
    it("should retrieve a paginated records list matching search/type filter", async () => {
      const response = await request(app)
        .get("/api/v1/records?page=1&limit=5&type=BLOOD_TEST&search=apollo")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.records).toHaveLength(1);
      expect(response.body.data.records[0].id).toBe(uploadedRecordId);
      expect(response.body.data.pagination.total).toBe(1);
    });

    it("should fetch details of an individual record", async () => {
      const response = await request(app)
        .get(`/api/v1/records/${uploadedRecordId}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.fileName).toBe("test_blood_report.pdf");
    });

    it("should fetch AI summary results for a record", async () => {
      const response = await request(app)
        .get(`/api/v1/records/${uploadedRecordId}/ai-summary`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("processingStatus");
      expect(response.body.data).toHaveProperty("aiResult");
      expect(response.body.data).toHaveProperty("extractedValues");
    });

    it("should generate a 15-minute temporary presigned URL successfully", async () => {
      const response = await request(app)
        .get(`/api/v1/records/${uploadedRecordId}/signed-url`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.signedUrl).toContain("http://localhost:9000/medicore-documents");
      expect(response.body.data.signedUrl).toContain("X-Amz-Expires=900");
    });

    it("should soft-delete the record and remove file from S3 bucket", async () => {
      const deleteResponse = await request(app)
        .delete(`/api/v1/records/${uploadedRecordId}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);

      // Verify subsequent retrieve returns 404
      const getResponse = await request(app)
        .get(`/api/v1/records/${uploadedRecordId}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(getResponse.status).toBe(404);
    }, 15000);
  });
});
