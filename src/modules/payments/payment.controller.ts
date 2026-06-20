import { Request, Response, NextFunction } from "express";
import { PlanTier, SubscriptionStatus, PaymentStatus, PaymentProvider } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../shared/middleware/errorHandler";
import { createOrderSchema, verifyPaymentSchema, validateCouponSchema } from "./payment.schema";
import { PLANS, getPlan } from "./plan.config";
import { createRazorpayOrder, verifyPaymentSignature } from "./razorpay.service";
import { validateCoupon, recordCouponUsage } from "./coupon.service";
import { env } from "../../config/env";

export class PaymentController {
  /** GET /payments/subscription — current subscription (auto-creates FREE if none exists) */
  static async getSubscription(req: Request, res: Response, next: NextFunction) {
    try {
      const sub = await PaymentController._getOrCreateFreeSubscription(req.user!.id);
      res.json({ success: true, data: sub });
    } catch (err) {
      next(err);
    }
  }

  /** POST /payments/validate-coupon — preview discount without purchasing */
  static async validateCoupon(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, planId } = validateCouponSchema.parse(req.body);
      const plan = getPlan(PlanTier[planId as keyof typeof PlanTier]);
      if (!plan) throw new AppError(400, "Invalid plan", "INVALID_PLAN");

      const result = await validateCoupon(code, plan.id, req.user!.id, plan.priceInPaise);

      res.json({
        success: true,
        data: {
          code: result.code,
          discountType: result.discountType,
          discountValue: result.discountValue,
          discountAmount: result.discountAmountInPaise / 100,
          finalPrice: result.finalPriceInPaise / 100,
          description: result.description,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /** POST /payments/create-order — create Razorpay order before showing checkout */
  static async createOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const { planId, couponCode } = createOrderSchema.parse(req.body);
      const plan = getPlan(PlanTier[planId as keyof typeof PlanTier]);
      if (!plan) throw new AppError(400, "Invalid plan", "INVALID_PLAN");

      let amountInPaise = plan.priceInPaise;
      let discountAmountInPaise = 0;
      let appliedCoupon = null;

      if (couponCode) {
        const couponResult = await validateCoupon(
          couponCode,
          plan.id,
          req.user!.id,
          plan.priceInPaise
        );
        amountInPaise = couponResult.finalPriceInPaise;
        discountAmountInPaise = couponResult.discountAmountInPaise;
        appliedCoupon = couponResult;
      }

      // Razorpay minimum order is ₹1 (100 paise)
      if (amountInPaise < 100) amountInPaise = 100;

      const order = await createRazorpayOrder({
        amountInPaise,
        receipt: `sub_${req.user!.id.slice(-12)}`,
        notes: {
          userId: req.user!.id,
          planId,
          couponCode: couponCode ?? "",
        },
      });

      res.json({
        success: true,
        data: {
          orderId: order.id,
          amount: amountInPaise,
          currency: "INR",
          keyId: env.RAZORPAY_KEY_ID,
          planId,
          planName: plan.name,
          originalPrice: plan.priceDisplay,
          discountAmount: discountAmountInPaise / 100,
          finalPrice: amountInPaise / 100,
          coupon: appliedCoupon
            ? { code: appliedCoupon.code, discountValue: appliedCoupon.discountValue }
            : null,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /** POST /payments/verify — verify signature & activate subscription (idempotent) */
  static async verifyPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature, planId, couponCode } =
        verifyPaymentSchema.parse(req.body);

      // 1. Verify HMAC signature
      const isValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
      if (!isValid) throw new AppError(400, "Payment signature verification failed", "INVALID_SIGNATURE");

      // 2. Idempotency — don't process the same payment twice
      const existing = await prisma.payment.findFirst({
        where: { providerPaymentId: razorpayPaymentId },
      });
      if (existing) {
        const sub = await prisma.subscription.findUnique({ where: { userId: req.user!.id } });
        return res.json({ success: true, message: "Already processed", data: sub });
      }

      const plan = getPlan(PlanTier[planId as keyof typeof PlanTier]);
      if (!plan || !plan.durationMonths) throw new AppError(400, "Invalid plan", "INVALID_PLAN");

      // 3. Re-validate coupon (prevents race: coupon might have been exhausted between order + verify)
      let finalAmountInPaise = plan.priceInPaise;
      let discountAmountInPaise = 0;
      let couponId: string | undefined;

      if (couponCode) {
        const couponResult = await validateCoupon(
          couponCode,
          plan.id,
          req.user!.id,
          plan.priceInPaise
        );
        finalAmountInPaise = couponResult.finalPriceInPaise;
        discountAmountInPaise = couponResult.discountAmountInPaise;
        couponId = couponResult.couponId;
      }

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + plan.durationMonths);

      // 4. Atomic transaction: subscription + payment + coupon usage
      const result = await prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.upsert({
          where: { userId: req.user!.id },
          create: {
            userId: req.user!.id,
            plan: plan.id,
            billingCycle: plan.billingCycle!,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
          },
          update: {
            plan: plan.id,
            billingCycle: plan.billingCycle!,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
          },
        });

        const payment = await tx.payment.create({
          data: {
            subscriptionId: subscription.id,
            amount: finalAmountInPaise / 100,
            currency: "INR",
            status: PaymentStatus.SUCCEEDED,
            provider: PaymentProvider.RAZORPAY,
            providerPaymentId: razorpayPaymentId,
            razorpayOrderId,
            discountAmount: discountAmountInPaise / 100,
            couponCode: couponCode ?? null,
            paidAt: now,
          },
        });

        if (couponId) {
          await recordCouponUsage(tx, couponId, req.user!.id);
        }

        return { subscription, payment };
      });

      res.json({
        success: true,
        message: "Subscription activated",
        data: result.subscription,
      });
    } catch (err) {
      next(err);
    }
  }

  /** GET /payments/invoices — list past payments */
  static async getInvoices(req: Request, res: Response, next: NextFunction) {
    try {
      const sub = await prisma.subscription.findUnique({ where: { userId: req.user!.id } });
      if (!sub) return res.json({ success: true, data: [] });

      const payments = await prisma.payment.findMany({
        where: { subscriptionId: sub.id },
        orderBy: { createdAt: "desc" },
      });

      res.json({ success: true, data: payments });
    } catch (err) {
      next(err);
    }
  }

  /** POST /payments/cancel — mark subscription to cancel at period end */
  static async cancelSubscription(req: Request, res: Response, next: NextFunction) {
    try {
      const sub = await prisma.subscription.findUnique({ where: { userId: req.user!.id } });
      if (!sub) throw new AppError(404, "No active subscription found", "NOT_FOUND");
      if (sub.status !== SubscriptionStatus.ACTIVE) {
        throw new AppError(400, "Subscription is not active", "INVALID_STATUS");
      }

      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: { cancelAtPeriodEnd: true },
      });

      res.json({ success: true, message: "Subscription will cancel at period end", data: updated });
    } catch (err) {
      next(err);
    }
  }

  // Helper — lazy-create a FREE subscription if none exists
  static async _getOrCreateFreeSubscription(userId: string) {
    const existing = await prisma.subscription.findUnique({ where: { userId } });
    if (existing) return existing;

    return prisma.subscription.create({
      data: {
        userId,
        plan: PlanTier.FREE,
        billingCycle: "MONTHLY",
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date("2099-12-31"),
      },
    });
  }
}
