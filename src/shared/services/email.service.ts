import { Resend } from "resend";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

const resend = new Resend(env.RESEND_API_KEY);

const FROM = env.EMAIL_FROM;

export async function sendOtpEmail(to: string, otp: string, purpose: "login" | "signup") {
  const subject =
    purpose === "signup"
      ? "Verify your MediCore account"
      : "Your MediCore login OTP";

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </head>
    <body style="margin:0;padding:0;background:#eef0fb;font-family:'Segoe UI',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
        <tr>
          <td align="center">
            <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,0.10);">

              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#0c1033 0%,#1a1660 60%,#4338ca 100%);padding:32px 40px;text-align:center;">
                  <span style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Medi<span style="color:#a5b4fc;">Core</span></span>
                  <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:6px 0 0;">Your Personal Health Vault</p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:36px 40px;">
                  <p style="margin:0 0 8px;font-size:15px;color:#475569;">
                    ${purpose === "signup" ? "Welcome! Use the code below to verify your email address." : "Use the code below to log in to your account."}
                  </p>
                  <p style="margin:0 0 28px;font-size:13px;color:#94a3b8;">
                    This code expires in <strong>5 minutes</strong>. Do not share it with anyone.
                  </p>

                  <!-- OTP Box -->
                  <div style="background:#f0f0ff;border:2px dashed #6366f1;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px;">
                    <span style="font-size:42px;font-weight:800;letter-spacing:12px;color:#4338ca;font-family:'Courier New',monospace;">${otp}</span>
                  </div>

                  <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
                    If you didn't request this, you can safely ignore this email.
                    Your account remains secure.
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background:#f8faff;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
                  <p style="margin:0;font-size:12px;color:#94a3b8;">
                    © ${new Date().getFullYear()} MediCore Health · Secure Electronic Health Records
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html,
    });

    if (error) {
      logger.error(`Resend email failed to ${to}: ${JSON.stringify(error)}`);
      return false;
    }

    logger.info(`OTP email sent to ${to} (id: ${data?.id})`);
    return true;
  } catch (err) {
    logger.error(`Email service exception: ${err}`);
    return false;
  }
}

export async function sendEmail(to: string, subject: string, html: string) {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html,
    });

    if (error) {
      logger.error(`Resend email failed to ${to}: ${JSON.stringify(error)}`);
      return false;
    }

    logger.info(`Email sent to ${to} (id: ${data?.id})`);
    return true;
  } catch (err) {
    logger.error(`Email service exception: ${err}`);
    return false;
  }
}
