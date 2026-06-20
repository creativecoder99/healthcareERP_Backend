import { Router } from "express";
import express from "express";
import { WebhookController } from "./webhook.controller";

const router = Router();

// Raw body needed for signature verification — override JSON middleware for this route
router.post(
  "/razorpay",
  express.raw({ type: "application/json" }),
  (req, _res, next) => {
    // Parse raw buffer back to object for our handler (signature already extracted from headers)
    if (Buffer.isBuffer(req.body)) {
      req.body = JSON.parse(req.body.toString("utf8"));
    }
    next();
  },
  WebhookController.razorpay
);

export const webhookRouter = router;
