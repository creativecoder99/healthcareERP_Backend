import { Router } from "express";
import { AuthController } from "./auth.controller";
import { authenticate } from "../../shared/middleware/auth.middleware";

const router = Router();

router.post("/register", AuthController.register);
router.post("/register/otp/request", AuthController.requestRegisterOtp);
router.post("/register/otp/verify", AuthController.verifyRegisterOtp);
router.post("/otp/request", AuthController.requestOtp);
router.post("/login", AuthController.login);
router.post("/refresh", AuthController.refresh);
router.post("/logout", AuthController.logout);
router.get("/me", authenticate, AuthController.me);

export const authRouter = router;
export default authRouter;
