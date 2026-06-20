import Razorpay from "razorpay";
import crypto from "crypto";
import { env } from "../../config/env";

// Singleton Razorpay client
export const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

export interface CreateOrderParams {
  amountInPaise: number;
  receipt: string; // max 40 chars — use userId slice
  notes?: Record<string, string>;
}

/** Create a Razorpay order (server-side, before showing checkout) */
export async function createRazorpayOrder(params: CreateOrderParams) {
  const order = await razorpay.orders.create({
    amount: params.amountInPaise,
    currency: "INR",
    receipt: params.receipt.slice(0, 40),
    notes: params.notes,
  });
  return order;
}

/**
 * Verify the payment signature Razorpay sends to the client after payment.
 * Must be validated server-side to confirm payment authenticity.
 *
 * Signature = HMAC-SHA256(orderId + "|" + paymentId, keySecret)
 */
export function verifyPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): boolean {
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");
  return expected === razorpaySignature;
}

/**
 * Verify Razorpay webhook signature.
 * Header: X-Razorpay-Signature
 * Signature = HMAC-SHA256(rawBody, webhookSecret)
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = env.RAZORPAY_WEBHOOK_SECRET ?? env.RAZORPAY_KEY_SECRET;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return expected === signature;
}
