import { z } from "zod";

export const requestAccessSchema = z.object({
  patientEmail: z.string().email("Valid patient email required"),
});

export const inviteDoctorSchema = z.object({
  doctorEmail: z.string().email("Valid doctor email required"),
});
