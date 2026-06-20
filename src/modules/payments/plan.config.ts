import { PlanTier, BillingCycle } from "@prisma/client";

export interface PlanFeatures {
  aiChatbot: boolean;
  aiSummaryMasked: boolean; // true = summary is visible in full
  recordUploadLimit: number | null; // null = unlimited
  doctorLinking: boolean;
}

export interface PlanConfig {
  id: PlanTier;
  name: string;
  description: string;
  priceInPaise: number;       // Razorpay uses paise (₹1 = 100 paise)
  priceDisplay: number;       // display price in ₹
  durationMonths: number | null;
  billingCycle: BillingCycle | null;
  features: PlanFeatures;
  popular?: boolean;
}

export const PLANS: Record<"FREE" | "PRO_6M" | "PRO_1Y", PlanConfig> = {
  FREE: {
    id: PlanTier.FREE,
    name: "Free",
    description: "Basic health vault with limited features",
    priceInPaise: 0,
    priceDisplay: 0,
    durationMonths: null,
    billingCycle: null,
    features: {
      aiChatbot: false,
      aiSummaryMasked: true,   // summary is locked/blurred
      recordUploadLimit: 10,
      doctorLinking: true,
    },
  },

  PRO_6M: {
    id: PlanTier.PRO_6M,
    name: "Pro · 6 Months",
    description: "Full access for 6 months — AI summaries + chatbot unlocked",
    priceInPaise: 49900,       // ₹499 inclusive of 18% GST
    priceDisplay: 499,
    durationMonths: 6,
    billingCycle: BillingCycle.SIX_MONTHS,
    features: {
      aiChatbot: true,
      aiSummaryMasked: false,
      recordUploadLimit: null,
      doctorLinking: true,
    },
  },

  PRO_1Y: {
    id: PlanTier.PRO_1Y,
    name: "Pro · 1 Year",
    description: "Best value — full access for a whole year",
    priceInPaise: 99900,       // ₹999 inclusive of 18% GST
    priceDisplay: 999,
    durationMonths: 12,
    billingCycle: BillingCycle.YEARLY,
    popular: true,
    features: {
      aiChatbot: true,
      aiSummaryMasked: false,
      recordUploadLimit: null,
      doctorLinking: true,
    },
  },
};

export const PAID_PLAN_IDS: PlanTier[] = [PlanTier.PRO_6M, PlanTier.PRO_1Y];

export function getPlan(id: PlanTier): PlanConfig | undefined {
  return Object.values(PLANS).find((p) => p.id === id);
}

export function isPaidPlan(id: PlanTier): boolean {
  return PAID_PLAN_IDS.includes(id);
}

/** Base price in paise after applying a percentage or fixed coupon discount */
export function applyDiscount(
  priceInPaise: number,
  discountType: "PERCENTAGE" | "FIXED",
  discountValue: number
): number {
  if (discountType === "PERCENTAGE") {
    const discounted = priceInPaise * (1 - discountValue / 100);
    return Math.round(discounted);
  }
  // FIXED: discountValue is in ₹, convert to paise
  const discounted = priceInPaise - discountValue * 100;
  return Math.max(0, Math.round(discounted));
}
