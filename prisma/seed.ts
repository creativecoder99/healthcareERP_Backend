import { Role, PlanTier, BillingCycle, DiscountType, PaymentStatus, PaymentProvider } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("🌱 Seeding database...");

  const passwordHash = await bcrypt.hash("Password@123", 12);
  const now = new Date();
  const oneYear = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  const sixMonths = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());

  // ─── Platform Admin ────────────────────────────────────────────────────────
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@test.com" },
    update: {},
    create: {
      email: "admin@test.com",
      passwordHash,
      role: Role.PLATFORM_ADMIN,
      isVerified: true,
    },
  });

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
          state: "Maharashtra",
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
          state: "Karnataka",
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
    include: {
      subscription: true,
    },
  });

  if (patientUser2.subscription) {
    await prisma.payment.upsert({
      where: { razorpayOrderId: "order_seed_patient2" },
      update: {},
      create: {
        subscriptionId: patientUser2.subscription.id,
        amount: 8999,
        currency: "INR",
        status: PaymentStatus.SUCCEEDED,
        provider: PaymentProvider.RAZORPAY,
        providerPaymentId: "pay_seed_patient2",
        razorpayOrderId: "order_seed_patient2",
        paidAt: now,
      },
    });
  }

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

  // ─── Seed Extra Patients with States & Payments ────────────────────────────
  const indianStates = ["Maharashtra", "Delhi", "Karnataka", "Tamil Nadu", "Telangana", "Gujarat", "Uttar Pradesh", "West Bengal", "Kerala", "Rajasthan"];
  const plans = [
    { tier: PlanTier.FREE, cycle: BillingCycle.MONTHLY, price: 0 },
    { tier: PlanTier.BASIC, cycle: BillingCycle.MONTHLY, price: 499 },
    { tier: PlanTier.PRO, cycle: BillingCycle.MONTHLY, price: 999 },
    { tier: PlanTier.FAMILY, cycle: BillingCycle.MONTHLY, price: 1499 },
    { tier: PlanTier.PRO_6M, cycle: BillingCycle.SIX_MONTHS, price: 4999 },
    { tier: PlanTier.PRO_1Y, cycle: BillingCycle.YEARLY, price: 8999 }
  ];

  const firstNames = ["Amit", "Rohan", "Siddharth", "Vikram", "Karan", "Anjali", "Neha", "Divya", "Pooja", "Meera", "Suresh", "Rahul", "Vijay", "Aisha", "Aditi"];
  const lastNames = ["Kumar", "Singh", "Joshi", "Patel", "Reddy", "Sharma", "Nair", "Verma", "Sen", "Rao", "Gupta", "Das", "Choudhury", "Pillai"];

  for (let i = 1; i <= 22; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[i % lastNames.length];
    const fullName = `${firstName} ${lastName}`;
    const email = `patient.seed${i}@test.com`;
    const state = indianStates[i % indianStates.length];
    const planChoice = plans[i % plans.length];

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        role: Role.PATIENT,
        isVerified: true,
        patient: {
          create: {
            fullName,
            dateOfBirth: new Date(1975 + (i * 2) % 30, i % 12, (i * 3) % 28 + 1),
            gender: i % 2 === 0 ? "Female" : "Male",
            bloodGroup: ["A+", "B+", "O+", "AB+", "O-", "A-"][i % 6],
            heightCm: 155 + (i * 3) % 30,
            weightKg: 50 + (i * 2) % 45,
            state,
          }
        },
        subscription: {
          create: {
            plan: planChoice.tier,
            billingCycle: planChoice.cycle,
            currentPeriodStart: now,
            currentPeriodEnd: planChoice.tier === PlanTier.FREE ? new Date("2099-12-31") : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000 * (planChoice.cycle === BillingCycle.YEARLY ? 12 : planChoice.cycle === BillingCycle.SIX_MONTHS ? 6 : 1)),
          }
        }
      },
      include: {
        subscription: true
      }
    });

    // For paid plans, seed a payment history
    if (planChoice.price > 0 && user.subscription) {
      await prisma.payment.upsert({
        where: { razorpayOrderId: `order_mock_${user.id.slice(-8)}${i}` },
        update: {},
        create: {
          subscriptionId: user.subscription.id,
          amount: planChoice.price,
          currency: "INR",
          status: i % 7 === 0 ? PaymentStatus.REFUNDED : PaymentStatus.SUCCEEDED,
          provider: PaymentProvider.RAZORPAY,
          providerPaymentId: `pay_mock_${user.id.slice(-8)}${i}`,
          razorpayOrderId: `order_mock_${user.id.slice(-8)}${i}`,
          paidAt: now,
        }
      });
    }
  }

  console.log("✅ Seed complete:");
  console.log(`   Admin:     admin@test.com (Password@123) — ${adminUser.id}`);
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
