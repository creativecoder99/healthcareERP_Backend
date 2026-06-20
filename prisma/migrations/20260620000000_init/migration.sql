-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AccessScope" AS ENUM ('ALL', 'SELECTED');

-- CreateEnum
CREATE TYPE "public"."AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "public"."AppointmentType" AS ENUM ('VIDEO', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "public"."BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'SIX_MONTHS');

-- CreateEnum
CREATE TYPE "public"."ChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "public"."LinkInitiator" AS ENUM ('PATIENT', 'DOCTOR');

-- CreateEnum
CREATE TYPE "public"."LinkStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('ACCESS_REQUEST', 'ACCESS_APPROVED', 'ACCESS_REVOKED', 'DOCTOR_INVITE', 'NEW_PRESCRIPTION', 'APPOINTMENT_REMINDER', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'REPORT_PROCESSED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."OrgType" AS ENUM ('HOSPITAL', 'CLINIC', 'DIAGNOSTIC_LAB', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."PaymentProvider" AS ENUM ('STRIPE', 'RAZORPAY');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "public"."PlanTier" AS ENUM ('FREE', 'BASIC', 'PRO', 'FAMILY', 'DOCTOR_STARTER', 'DOCTOR_PROFESSIONAL', 'DOCTOR_ENTERPRISE', 'PRO_6M', 'PRO_1Y');

-- CreateEnum
CREATE TYPE "public"."ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "public"."RecordType" AS ENUM ('BLOOD_TEST', 'URINE_TEST', 'IMAGING_XRAY', 'IMAGING_MRI', 'IMAGING_CT', 'IMAGING_ULTRASOUND', 'PRESCRIPTION', 'DISCHARGE_SUMMARY', 'VACCINATION', 'DENTAL', 'OPHTHALMOLOGY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('PATIENT', 'DOCTOR', 'ORG_ADMIN', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'PAUSED', 'TRIALING');

-- CreateEnum
CREATE TYPE "public"."VideoStatus" AS ENUM ('WAITING', 'ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "public"."Appointment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL DEFAULT 30,
    "status" "public"."AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "type" "public"."AppointmentType" NOT NULL DEFAULT 'VIDEO',
    "notes" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "public"."Role" NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AvailabilitySlot" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "slotMins" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "public"."ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChatSession" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" "public"."DiscountType" NOT NULL DEFAULT 'PERCENTAGE',
    "discountValue" DOUBLE PRECISION NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "applicablePlans" "public"."PlanTier"[],
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CouponUsage" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Doctor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "specialisation" TEXT NOT NULL,
    "licenceNumber" TEXT NOT NULL,
    "licenceVerified" BOOLEAN NOT NULL DEFAULT false,
    "consultationFee" DOUBLE PRECISION,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "orgId" TEXT,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DoctorNote" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "recordId" TEXT,
    "patientId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MedicalRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "recordType" "public"."RecordType" NOT NULL,
    "recordDate" TIMESTAMP(3),
    "facilityName" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStatus" "public"."ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrgAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "OrgAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."OrgType" NOT NULL,
    "address" TEXT,
    "logoUrl" TEXT,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Patient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "bloodGroup" TEXT,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "allergies" TEXT[],
    "currentMeds" JSONB,
    "emergencyContact" JSONB,
    "insuranceInfo" JSONB,
    "avatarUrl" TEXT,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PatientDoctorLink" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "status" "public"."LinkStatus" NOT NULL DEFAULT 'PENDING',
    "initiatedBy" "public"."LinkInitiator" NOT NULL,
    "accessScope" "public"."AccessScope" NOT NULL DEFAULT 'ALL',
    "scopeRecordIds" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "inviteToken" TEXT,

    CONSTRAINT "PatientDoctorLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Payment" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "public"."PaymentStatus" NOT NULL,
    "provider" "public"."PaymentProvider" NOT NULL,
    "providerPaymentId" TEXT,
    "invoiceUrl" TEXT,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "couponCode" TEXT,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "razorpayOrderId" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Prescription" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "recordId" TEXT,
    "medicines" JSONB NOT NULL,
    "notes" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RecordAIResult" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "summaryText" TEXT NOT NULL,
    "clinicalSummary" TEXT,
    "extractedRaw" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "flaggedValues" JSONB,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelVersion" TEXT NOT NULL,

    CONSTRAINT "RecordAIResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RecordExtractedValue" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "parameterKey" TEXT NOT NULL,
    "parameterLabel" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "referenceMin" DOUBLE PRECISION,
    "referenceMax" DOUBLE PRECISION,
    "isAbnormal" BOOLEAN NOT NULL,
    "severity" TEXT,
    "recordDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordExtractedValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RecordVectorChunk" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "embedding" vector(768),

    CONSTRAINT "RecordVectorChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "public"."PlanTier" NOT NULL,
    "billingCycle" "public"."BillingCycle" NOT NULL,
    "status" "public"."SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "stripeSubId" TEXT,
    "razorpaySubId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "phone" TEXT,
    "role" "public"."Role" NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "twoFAEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFASecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VideoSession" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "status" "public"."VideoStatus" NOT NULL DEFAULT 'WAITING',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "recordingKey" TEXT,
    "iceServers" JSONB,

    CONSTRAINT "VideoSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appointment_doctorId_idx" ON "public"."Appointment"("doctorId" ASC);

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "public"."Appointment"("patientId" ASC);

-- CreateIndex
CREATE INDEX "Appointment_scheduledAt_idx" ON "public"."Appointment"("scheduledAt" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "public"."AuditLog"("actorId" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "public"."AuditLog"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_resourceId_idx" ON "public"."AuditLog"("resourceId" ASC);

-- CreateIndex
CREATE INDEX "AvailabilitySlot_doctorId_idx" ON "public"."AvailabilitySlot"("doctorId" ASC);

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_idx" ON "public"."ChatMessage"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "ChatSession_patientId_idx" ON "public"."ChatSession"("patientId" ASC);

-- CreateIndex
CREATE INDEX "Coupon_code_idx" ON "public"."Coupon"("code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "public"."Coupon"("code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CouponUsage_couponId_userId_key" ON "public"."CouponUsage"("couponId" ASC, "userId" ASC);

-- CreateIndex
CREATE INDEX "CouponUsage_userId_idx" ON "public"."CouponUsage"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_licenceNumber_key" ON "public"."Doctor"("licenceNumber" ASC);

-- CreateIndex
CREATE INDEX "Doctor_orgId_idx" ON "public"."Doctor"("orgId" ASC);

-- CreateIndex
CREATE INDEX "Doctor_userId_idx" ON "public"."Doctor"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_userId_key" ON "public"."Doctor"("userId" ASC);

-- CreateIndex
CREATE INDEX "DoctorNote_doctorId_patientId_idx" ON "public"."DoctorNote"("doctorId" ASC, "patientId" ASC);

-- CreateIndex
CREATE INDEX "MedicalRecord_patientId_idx" ON "public"."MedicalRecord"("patientId" ASC);

-- CreateIndex
CREATE INDEX "MedicalRecord_patientId_recordType_idx" ON "public"."MedicalRecord"("patientId" ASC, "recordType" ASC);

-- CreateIndex
CREATE INDEX "MedicalRecord_processingStatus_idx" ON "public"."MedicalRecord"("processingStatus" ASC);

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "public"."Notification"("userId" ASC, "isRead" ASC);

-- CreateIndex
CREATE INDEX "OrgAdmin_orgId_idx" ON "public"."OrgAdmin"("orgId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OrgAdmin_userId_key" ON "public"."OrgAdmin"("userId" ASC);

-- CreateIndex
CREATE INDEX "Patient_userId_idx" ON "public"."Patient"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Patient_userId_key" ON "public"."Patient"("userId" ASC);

-- CreateIndex
CREATE INDEX "PatientDoctorLink_doctorId_idx" ON "public"."PatientDoctorLink"("doctorId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PatientDoctorLink_inviteToken_key" ON "public"."PatientDoctorLink"("inviteToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PatientDoctorLink_patientId_doctorId_key" ON "public"."PatientDoctorLink"("patientId" ASC, "doctorId" ASC);

-- CreateIndex
CREATE INDEX "PatientDoctorLink_patientId_idx" ON "public"."PatientDoctorLink"("patientId" ASC);

-- CreateIndex
CREATE INDEX "Payment_razorpayOrderId_idx" ON "public"."Payment"("razorpayOrderId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "public"."Payment"("razorpayOrderId" ASC);

-- CreateIndex
CREATE INDEX "Payment_subscriptionId_idx" ON "public"."Payment"("subscriptionId" ASC);

-- CreateIndex
CREATE INDEX "Prescription_doctorId_idx" ON "public"."Prescription"("doctorId" ASC);

-- CreateIndex
CREATE INDEX "Prescription_patientId_idx" ON "public"."Prescription"("patientId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RecordAIResult_recordId_key" ON "public"."RecordAIResult"("recordId" ASC);

-- CreateIndex
CREATE INDEX "RecordExtractedValue_parameterKey_recordDate_idx" ON "public"."RecordExtractedValue"("parameterKey" ASC, "recordDate" ASC);

-- CreateIndex
CREATE INDEX "RecordExtractedValue_recordId_idx" ON "public"."RecordExtractedValue"("recordId" ASC);

-- CreateIndex
CREATE INDEX "RecordVectorChunk_patientId_idx" ON "public"."RecordVectorChunk"("patientId" ASC);

-- CreateIndex
CREATE INDEX "RecordVectorChunk_recordId_idx" ON "public"."RecordVectorChunk"("recordId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_razorpaySubId_key" ON "public"."Subscription"("razorpaySubId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubId_key" ON "public"."Subscription"("stripeSubId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "public"."Subscription"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_refreshToken_key" ON "public"."UserSession"("refreshToken" ASC);

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "public"."UserSession"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VideoSession_appointmentId_key" ON "public"."VideoSession"("appointmentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VideoSession_roomId_key" ON "public"."VideoSession"("roomId" ASC);

-- AddForeignKey
ALTER TABLE "public"."Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "public"."Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AvailabilitySlot" ADD CONSTRAINT "AvailabilitySlot_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "public"."Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChatSession" ADD CONSTRAINT "ChatSession_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CouponUsage" ADD CONSTRAINT "CouponUsage_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "public"."Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CouponUsage" ADD CONSTRAINT "CouponUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Doctor" ADD CONSTRAINT "Doctor_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Doctor" ADD CONSTRAINT "Doctor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DoctorNote" ADD CONSTRAINT "DoctorNote_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "public"."Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DoctorNote" ADD CONSTRAINT "DoctorNote_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "public"."MedicalRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MedicalRecord" ADD CONSTRAINT "MedicalRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrgAdmin" ADD CONSTRAINT "OrgAdmin_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrgAdmin" ADD CONSTRAINT "OrgAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Patient" ADD CONSTRAINT "Patient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PatientDoctorLink" ADD CONSTRAINT "PatientDoctorLink_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "public"."Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PatientDoctorLink" ADD CONSTRAINT "PatientDoctorLink_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Prescription" ADD CONSTRAINT "Prescription_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Prescription" ADD CONSTRAINT "Prescription_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "public"."Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Prescription" ADD CONSTRAINT "Prescription_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "public"."MedicalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecordAIResult" ADD CONSTRAINT "RecordAIResult_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "public"."MedicalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecordExtractedValue" ADD CONSTRAINT "RecordExtractedValue_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "public"."MedicalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecordVectorChunk" ADD CONSTRAINT "RecordVectorChunk_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "public"."MedicalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VideoSession" ADD CONSTRAINT "VideoSession_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
