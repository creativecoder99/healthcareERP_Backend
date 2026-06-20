import { PrismaClient, Role, PlanTier, BillingCycle, DiscountType } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

let prisma: PrismaClient;

if (process.env.DATABASE_URL!.includes("neon.tech")) {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  prisma = new PrismaClient({ adapter });
} else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
}

async function main() {
  console.log("🌱 Seeding database...");

  const passwordHash = await bcrypt.hash("Password@123", 12);
  const now = new Date();
  const oneYear = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  const sixMonths = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());

  // ─── Launch Coupon ─────────────────────────────────────────────────────────
  await prisma.coupon.upsert({
    where: { code: "LAUNCH50" },
    update: {},
    create: {
      code: "LAUNCH50",
      discountType: DiscountType.PERCENTAGE,
      discountValue: 50,
      maxUses: 100,
      usedCount: 0,
      validFrom: now,
      validUntil: sixMonths,
      isActive: true,
      applicablePlans: [PlanTier.PRO_6M, PlanTier.PRO_1Y],
      description: "50% off on any Pro plan — launch offer",
    },
  });

  // ─── Test Patient 1 ────────────────────────────────────────────────────────
  const patientUser1 = await prisma.user.upsert({
    where: { email: "patient1@test.com" },
    update: {},
    create: {
      email: "patient1@test.com",
      passwordHash,
      role: Role.PATIENT,
      isVerified: true,
      patient: {
        create: {
          fullName: "Arjun Sharma",
          dateOfBirth: new Date("1990-05-15"),
          gender: "Male",
          bloodGroup: "B+",
          heightCm: 175,
          weightKg: 72,
          allergies: ["Penicillin"],
        },
      },
      subscription: {
        create: {
          plan: PlanTier.FREE,
          billingCycle: BillingCycle.MONTHLY,
          currentPeriodStart: now,
          currentPeriodEnd: new Date("2099-12-31"),
        },
      },
    },
  });

  // ─── Test Patient 2 (Pro plan) ─────────────────────────────────────────────
  const patientUser2 = await prisma.user.upsert({
    where: { email: "patient2@test.com" },
    update: {},
    create: {
      email: "patient2@test.com",
      passwordHash,
      role: Role.PATIENT,
      isVerified: true,
      patient: {
        create: {
          fullName: "Priya Nair",
          dateOfBirth: new Date("1985-11-22"),
          gender: "Female",
          bloodGroup: "O+",
          heightCm: 162,
          weightKg: 58,
          allergies: [],
        },
      },
      subscription: {
        create: {
          plan: PlanTier.PRO_1Y,
          billingCycle: BillingCycle.YEARLY,
          currentPeriodStart: now,
          currentPeriodEnd: oneYear,
        },
      },
    },
  });

  // ─── Test Doctor 1 ─────────────────────────────────────────────────────────
  const doctorUser1 = await prisma.user.upsert({
    where: { email: "doctor1@test.com" },
    update: {},
    create: {
      email: "doctor1@test.com",
      passwordHash,
      role: Role.DOCTOR,
      isVerified: true,
      doctor: {
        create: {
          fullName: "Dr. Rahul Mehta",
          specialisation: "Internal Medicine",
          licenceNumber: "MH-12345",
          licenceVerified: true,
          consultationFee: 500,
          bio: "Experienced internal medicine physician with 12 years of practice.",
        },
      },
      subscription: {
        create: {
          plan: PlanTier.PRO_1Y,
          billingCycle: BillingCycle.YEARLY,
          currentPeriodStart: now,
          currentPeriodEnd: oneYear,
        },
      },
    },
  });

  // ─── Test Doctor 2 ─────────────────────────────────────────────────────────
  const doctorUser2 = await prisma.user.upsert({
    where: { email: "doctor2@test.com" },
    update: {},
    create: {
      email: "doctor2@test.com",
      passwordHash,
      role: Role.DOCTOR,
      isVerified: true,
      doctor: {
        create: {
          fullName: "Dr. Sneha Iyer",
          specialisation: "Endocrinology",
          licenceNumber: "TN-67890",
          licenceVerified: true,
          consultationFee: 800,
          bio: "Specialist in diabetes management and hormonal disorders.",
        },
      },
      subscription: {
        create: {
          plan: PlanTier.PRO_6M,
          billingCycle: BillingCycle.SIX_MONTHS,
          currentPeriodStart: now,
          currentPeriodEnd: sixMonths,
        },
      },
    },
  });

  console.log("✅ Seed complete:");
  console.log(`   Coupon:    LAUNCH50 (50% off, valid 6 months)`);
  console.log(`   Patient 1: patient1@test.com (FREE plan) — ${patientUser1.id}`);
  console.log(`   Patient 2: patient2@test.com (PRO_1Y)   — ${patientUser2.id}`);
  console.log(`   Doctor 1:  doctor1@test.com  (PRO_1Y)   — ${doctorUser1.id}`);
  console.log(`   Doctor 2:  doctor2@test.com  (PRO_6M)   — ${doctorUser2.id}`);
  console.log(`   Password for all: Password@123`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
