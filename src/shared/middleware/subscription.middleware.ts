import { Request, Response, NextFunction } from "express";
import { SubscriptionStatus, PlanTier } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { isPaidPlan } from "../../modules/payments/plan.config";

/**
 * Blocks the request if the user does not have an active paid subscription.
 * Used on chatbot, premium AI endpoints, etc.
 */
export async function requireActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const sub = await prisma.subscription.findUnique({ where: { userId: req.user!.id } });

    const isActive =
      sub &&
      sub.status === SubscriptionStatus.ACTIVE &&
      isPaidPlan(sub.plan) &&
      sub.currentPeriodEnd > new Date();

    if (!isActive) {
      return res.status(402).json({
        success: false,
        error: "SUBSCRIPTION_REQUIRED",
        message: "This feature requires an active Pro subscription.",
        upgradeUrl: "/pricing",
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}

/** Resolves subscription tier — returns FREE if none exists */
export async function getSubscriptionTier(userId: string): Promise<PlanTier> {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub || sub.status !== SubscriptionStatus.ACTIVE || sub.currentPeriodEnd < new Date()) {
    return PlanTier.FREE;
  }
  return sub.plan;
}
