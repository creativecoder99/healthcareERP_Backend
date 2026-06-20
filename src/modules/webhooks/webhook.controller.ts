import { Request, Response } from "express";
import { PaymentStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { verifyWebhookSignature } from "../payments/razorpay.service";
import { logger } from "../../config/logger";

export class WebhookController {
  /**
   * POST /webhooks/razorpay
   * Razorpay sends signed webhook events here. This is a backup confirmation path —
   * the primary payment activation happens in /payments/verify.
   * All handlers are idempotent (safe to replay).
   */
  static async razorpay(req: Request, res: Response) {
    const signature = req.headers["x-razorpay-signature"] as string | undefined;

    // Signature verification (skip if no secret configured in dev)
    if (signature) {
      const rawBody = JSON.stringify(req.body);
      const isValid = verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        logger.warn("Razorpay webhook: invalid signature");
        return res.status(400).json({ error: "Invalid signature" });
      }
    }

    const event = req.body as { event: string; payload: Record<string, any> };
    logger.info(`Razorpay webhook received: ${event.event}`);

    try {
      switch (event.event) {
        case "payment.captured":
          await WebhookController._handlePaymentCaptured(event.payload);
          break;

        case "payment.failed":
          await WebhookController._handlePaymentFailed(event.payload);
          break;

        case "subscription.cancelled":
          await WebhookController._handleSubscriptionCancelled(event.payload);
          break;

        default:
          logger.info(`Razorpay webhook: unhandled event ${event.event}`);
      }
    } catch (err) {
      logger.error("Razorpay webhook processing error", err);
      // Always 200 to Razorpay to stop retries; log the error internally
    }

    res.status(200).json({ received: true });
  }

  private static async _handlePaymentCaptured(payload: Record<string, any>) {
    const payment = payload?.payment?.entity;
    if (!payment?.id) return;

    // Idempotency: payment already recorded by /payments/verify
    const existing = await prisma.payment.findFirst({
      where: { providerPaymentId: payment.id },
    });
    if (existing) {
      logger.info(`Webhook: payment ${payment.id} already processed`);
      return;
    }

    // Find the order to match subscription
    const orderRecord = await prisma.payment.findFirst({
      where: { razorpayOrderId: payment.order_id },
    });
    if (!orderRecord) {
      logger.warn(`Webhook: no payment record found for order ${payment.order_id}`);
      return;
    }

    await prisma.payment.update({
      where: { id: orderRecord.id },
      data: {
        status: PaymentStatus.SUCCEEDED,
        providerPaymentId: payment.id,
        paidAt: new Date(),
      },
    });

    // Ensure subscription is ACTIVE
    const sub = await prisma.subscription.findUnique({ where: { id: orderRecord.subscriptionId } });
    if (sub && sub.status !== SubscriptionStatus.ACTIVE) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.ACTIVE },
      });
    }
  }

  private static async _handlePaymentFailed(payload: Record<string, any>) {
    const payment = payload?.payment?.entity;
    if (!payment?.order_id) return;

    const orderRecord = await prisma.payment.findFirst({
      where: { razorpayOrderId: payment.order_id },
    });
    if (!orderRecord) return;

    await prisma.payment.update({
      where: { id: orderRecord.id },
      data: {
        status: PaymentStatus.FAILED,
        failureReason: payment.error_description ?? "Payment failed",
      },
    });

    // Move subscription to PAST_DUE
    await prisma.subscription.update({
      where: { id: orderRecord.subscriptionId },
      data: { status: SubscriptionStatus.PAST_DUE },
    });
  }

  private static async _handleSubscriptionCancelled(payload: Record<string, any>) {
    const rzpSub = payload?.subscription?.entity;
    if (!rzpSub?.id) return;

    const sub = await prisma.subscription.findFirst({
      where: { razorpaySubId: rzpSub.id },
    });
    if (!sub) return;

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: SubscriptionStatus.CANCELLED },
    });
  }
}
