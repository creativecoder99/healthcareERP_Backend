import { prisma } from "../../config/prisma";
import { redis } from "./redis";
import { logger } from "../../config/logger";
import { sendEmail } from "./email.service";
import { AppointmentStatus, NotificationType } from "@prisma/client";

export async function runReminderScan() {
  try {
    const now = new Date();
    const maxDate = new Date(now.getTime() + 25 * 3600 * 1000); // 25 hours from now

    const appointments = await prisma.appointment.findMany({
      where: {
        status: {
          in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
        },
        scheduledAt: {
          gte: now,
          lte: maxDate,
        },
      },
      include: {
        patient: {
          include: {
            user: { select: { id: true, email: true } },
          },
        },
        doctor: {
          include: {
            user: { select: { id: true, email: true } },
          },
        },
      },
    });

    for (const appt of appointments) {
      const diffMs = appt.scheduledAt.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 3600);

      // ─── 24 Hour Reminder ──────────────────────────────────────────────────
      if (diffHours <= 24 && diffHours > 22) {
        const redisKey = `reminder:sent:${appt.id}:24`;
        const alreadySent = await redis.get(redisKey);

        if (!alreadySent) {
          logger.info(`⏰ Sending 24h reminder for appointment ${appt.id}`);
          await sendReminder(appt, 24);
          await redis.set(redisKey, "true", "EX", 24 * 3600); // TTL 24 hours
        }
      }

      // ─── 1 Hour Reminder ───────────────────────────────────────────────────
      if (diffHours <= 1.2 && diffHours > 0) {
        const redisKey = `reminder:sent:${appt.id}:1`;
        const alreadySent = await redis.get(redisKey);

        if (!alreadySent) {
          logger.info(`⏰ Sending 1h reminder for appointment ${appt.id}`);
          await sendReminder(appt, 1);
          await redis.set(redisKey, "true", "EX", 2 * 3600); // TTL 2 hours
        }
      }
    }
  } catch (error: any) {
    logger.error(`❌ Error in appointment reminder scan: ${error.message}`);
  }
}

async function sendReminder(appt: any, hoursBefore: number) {
  const patientEmail = appt.patient.user.email;
  const doctorEmail = appt.doctor.user.email;
  const timeStr = appt.scheduledAt.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const subject = `Upcoming Video Consultation Reminder (${hoursBefore}h before)`;

  const patientHtml = `
    <h2>Upcoming Appointment Reminder</h2>
    <p>Dear ${appt.patient.fullName},</p>
    <p>This is a reminder for your upcoming video consultation with <strong>Dr. ${appt.doctor.fullName}</strong>.</p>
    <p><strong>Scheduled Time:</strong> ${timeStr} (IST)</p>
    <p>Please log in to your MediCore account and navigate to the appointments section to join the call.</p>
    <p>Regards,<br>MediCore Team</p>
  `;

  const doctorHtml = `
    <h2>Upcoming Appointment Reminder</h2>
    <p>Dear Dr. ${appt.doctor.fullName},</p>
    <p>This is a reminder for your upcoming video consultation with patient <strong>${appt.patient.fullName}</strong>.</p>
    <p><strong>Scheduled Time:</strong> ${timeStr} (IST)</p>
    <p>Please log in to your MediCore Doctor Portal to start the consultation.</p>
    <p>Regards,<br>MediCore Team</p>
  `;

  // Send Emails (don't let email failures block DB/Notifications)
  sendEmail(patientEmail, subject, patientHtml).catch((err) =>
    logger.error(`Failed to send reminder email to patient: ${err.message}`)
  );
  sendEmail(doctorEmail, subject, doctorHtml).catch((err) =>
    logger.error(`Failed to send reminder email to doctor: ${err.message}`)
  );

  // Save In-App Notifications
  await prisma.notification.createMany({
    data: [
      {
        userId: appt.patient.user.id,
        type: NotificationType.APPOINTMENT_REMINDER,
        title: `Appointment in ${hoursBefore} hour(s)`,
        body: `Your video call with Dr. ${appt.doctor.fullName} starts on ${timeStr}.`,
        data: { appointmentId: appt.id, hoursBefore },
      },
      {
        userId: appt.doctor.user.id,
        type: NotificationType.APPOINTMENT_REMINDER,
        title: `Appointment in ${hoursBefore} hour(s)`,
        body: `Your video call with ${appt.patient.fullName} starts on ${timeStr}.`,
        data: { appointmentId: appt.id, hoursBefore },
      },
    ],
  });
}

export function startReminderScheduler() {
  // Run scan once on startup
  setTimeout(runReminderScan, 5000);

  // Run scan every 10 minutes
  setInterval(runReminderScan, 10 * 60 * 1000);
  logger.info("⏰ Appointment reminder background scheduler initialized.");
}
