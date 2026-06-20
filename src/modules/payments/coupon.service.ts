import { PlanTier } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../shared/middleware/errorHandler";
import { applyDiscount } from "./plan.config";

export interface CouponValidationResult {
  couponId: string;
  code: string;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: number;
  discountAmountInPaise: number; // how much is knocked off
  finalPriceInPaise: number;
  description: string | null;
}

/**
 * Validates a coupon code for a given plan and user.
 * Throws AppError on any validation failure.
 * Does NOT record usage — call recordCouponUsage() inside the payment transaction.
 */
export async function validateCoupon(
  code: string,
  planId: PlanTier,
  userId: string,
  originalPriceInPaise: number
): Promise<CouponValidationResult> {
  const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });

  if (!coupon || !coupon.isActive) {
    throw new AppError(404, "Coupon code not found or expired", "INVALID_COUPON");
  }

  const now = new Date();
  if (coupon.validFrom > now) {
    throw new AppError(400, "This coupon is not yet active", "COUPON_NOT_ACTIVE");
  }
  if (coupon.validUntil && coupon.validUntil < now) {
    throw new AppError(400, "This coupon has expired", "COUPON_EXPIRED");
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    throw new AppError(400, "This coupon has reached its usage limit", "COUPON_EXHAUSTED");
  }

  // Plan restriction check
  if (coupon.applicablePlans.length > 0 && !coupon.applicablePlans.includes(planId)) {
    throw new AppError(400, "This coupon is not valid for the selected plan", "COUPON_PLAN_MISMATCH");
  }

  // Per-user uniqueness check
  const alreadyUsed = await prisma.couponUsage.findUnique({
    where: { couponId_userId: { couponId: coupon.id, userId } },
  });
  if (alreadyUsed) {
    throw new AppError(400, "You have already used this coupon", "COUPON_ALREADY_USED");
  }

  const finalPriceInPaise = applyDiscount(
    originalPriceInPaise,
    coupon.discountType,
    coupon.discountValue
  );
  const discountAmountInPaise = originalPriceInPaise - finalPriceInPaise;

  return {
    couponId: coupon.id,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountAmountInPaise,
    finalPriceInPaise,
    description: coupon.description,
  };
}

/** Call this inside the payment verification transaction */
export async function recordCouponUsage(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  couponId: string,
  userId: string
) {
  await tx.couponUsage.create({ data: { couponId, userId } });
  await tx.coupon.update({
    where: { id: couponId },
    data: { usedCount: { increment: 1 } },
  });
}
