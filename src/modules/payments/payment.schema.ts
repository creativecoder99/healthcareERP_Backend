import { z } from "zod";

export const createOrderSchema = z.object({
  planId: z.enum(["PRO_6M", "PRO_1Y"]),
  couponCode: z.string().max(20).optional(),
});

export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
  planId: z.enum(["PRO_6M", "PRO_1Y"]),
  couponCode: z.string().max(20).optional(),
});

export const validateCouponSchema = z.object({
  code: z.string().min(1).max(20),
  planId: z.enum(["PRO_6M", "PRO_1Y"]),
});
