import { Router } from "express";
import { authenticate } from "../../shared/middleware/auth.middleware";
import { PaymentController } from "./payment.controller";

const router = Router();
router.use(authenticate);

router.get("/subscription", PaymentController.getSubscription);
router.get("/invoices", PaymentController.getInvoices);
router.post("/validate-coupon", PaymentController.validateCoupon);
router.post("/create-order", PaymentController.createOrder);
router.post("/verify", PaymentController.verifyPayment);
router.post("/cancel", PaymentController.cancelSubscription);

export const paymentRouter = router;
