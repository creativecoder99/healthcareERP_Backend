import { z } from "zod";

export const createChatSessionSchema = z.object({
  title: z.string().max(100).optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1, "Message content is required").max(1000),
});
