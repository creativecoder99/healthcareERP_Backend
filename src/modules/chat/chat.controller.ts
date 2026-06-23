import { Request, Response, NextFunction } from "express";
import { prisma } from "../../config/prisma";
import { AppError } from "../../shared/middleware/errorHandler";
import { createChatSessionSchema, sendMessageSchema } from "./chat.schema";
import { generateEmbedding, generateChatStream } from "../../shared/services/gemini";
import { redis } from "../../shared/services/redis";
import { ChatRole, Role } from "@prisma/client";

const p = (v: string | string[]): string => (Array.isArray(v) ? v[0]! : v);

export class ChatController {
  // ─── Create Chat Session ───────────────────────────────────────────────────

  static async createSession(req: Request, res: Response, next: NextFunction) {
    try {
      const patient = await prisma.patient.findUnique({
        where: { userId: req.user!.id },
      });
      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PATIENT_NOT_FOUND");
      }

      const validated = createChatSessionSchema.parse(req.body);
      const session = await prisma.chatSession.create({
        data: {
          patientId: patient.id,
          title: validated.title || "New Conversation",
        },
      });

      res.status(201).json({
        success: true,
        data: session,
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── List Chat Sessions ─────────────────────────────────────────────────────

  static async listSessions(req: Request, res: Response, next: NextFunction) {
    try {
      const patient = await prisma.patient.findUnique({
        where: { userId: req.user!.id },
      });
      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PATIENT_NOT_FOUND");
      }

      const sessions = await prisma.chatSession.findMany({
        where: { patientId: patient.id },
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { content: true, createdAt: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Format sessions with preview message text
      const formatted = sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        lastMessage: s.messages[0]?.content || null,
      }));

      res.status(200).json({
        success: true,
        data: formatted,
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── List Messages ─────────────────────────────────────────────────────────

  static async listMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const sessionId = p(req.params.id);

      const patient = await prisma.patient.findUnique({
        where: { userId: req.user!.id },
      });
      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PATIENT_NOT_FOUND");
      }

      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
      });
      if (!session || session.patientId !== patient.id) {
        throw new AppError(403, "Access denied", "FORBIDDEN");
      }

      const messages = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: "asc" },
      });

      res.status(200).json({
        success: true,
        data: messages,
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── Send Message & Stream Response (RAG) ──────────────────────────────────

  static async sendMessageStream(req: Request, res: Response, next: NextFunction) {
    try {
      const sessionId = p(req.params.id);
      const validated = sendMessageSchema.parse(req.body);

      const patient = await prisma.patient.findUnique({
        where: { userId: req.user!.id },
      });
      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PATIENT_NOT_FOUND");
      }

      // Check chat session ownership
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
      });
      if (!session || session.patientId !== patient.id) {
        throw new AppError(403, "Access denied to this chat session", "FORBIDDEN");
      }

      // 1. Subscription Rate Limit Gating
      const sub = await prisma.subscription.findUnique({
        where: { userId: req.user!.id },
      });
      const isPaid = sub && sub.status === "ACTIVE" && sub.currentPeriodEnd > new Date();
      if (!isPaid) {
        // Enforce 30 msgs/day rate limit on free tier
        const todayStr = new Date().toISOString().split("T")[0];
        const redisKey = `rate:chat:${patient.id}:${todayStr}`;
        const currentCount = await redis.incr(redisKey);
        if (currentCount === 1) {
          await redis.expire(redisKey, 24 * 3600); // 24h expiration
        }

        if (currentCount > 30) {
          throw new AppError(429, "Daily rate limit reached. Upgrade to Pro for unlimited AI Chat.", "RATE_LIMIT_REACHED");
        }
      }

      // 2. Perform vector search matching for RAG
      const query = validated.content;
      const embedding = await generateEmbedding(query);
      const embeddingSql = `[${embedding.join(",")}]`;

      // Query database for matched context chunks scoped to this patient using pgvector
      const chunks: any[] = await prisma.$queryRawUnsafe(
        `SELECT c.id, c."recordId", c.content, c.metadata, (c.embedding <=> $1::vector) as distance, r."fileName"
         FROM "RecordVectorChunk" c
         JOIN "MedicalRecord" r ON c."recordId" = r.id
         WHERE c."patientId" = $2 AND r."deletedAt" IS NULL
         ORDER BY distance ASC
         LIMIT 4`,
        embeddingSql,
        patient.id
      );

      // Filter to relevant chunks
      const relevantChunks = chunks.filter((c) => c.distance < 0.85);

      // Format context block
      let contextText = "No relevant medical report excerpts found.";
      if (relevantChunks.length > 0) {
        contextText = relevantChunks
          .map(
            (c, idx) =>
              `Excerpt [${idx + 1}] (From Report: ${c.fileName}):\n${c.content}\n`
          )
          .join("\n");
      }

      // Unique citations
      const citations = relevantChunks.map((c) => ({
        recordId: c.recordId,
        fileName: c.fileName,
      })).filter((v, i, self) => self.findIndex((t) => t.recordId === v.recordId) === i);

      // 3. Fetch recent message history (last 8 messages)
      const prevMessages = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        take: 8,
      });
      prevMessages.reverse();

      // Format previous conversation logic for prompt
      const formattedHistory = prevMessages
        .map((m) => `${m.role === ChatRole.USER ? "Patient" : "Assistant"}: ${m.content}`)
        .join("\n");

      // 4. Save User Message
      await prisma.chatMessage.create({
        data: {
          sessionId,
          role: ChatRole.USER,
          content: query,
        },
      });

      // Update session title dynamically if it is a placeholder/default
      if (session.title === "New Conversation") {
        const titleText = query.length > 35 ? query.substring(0, 32) + "..." : query;
        await prisma.chatSession.update({
          where: { id: sessionId },
          data: { title: titleText },
        });
      }

      // 5. Establish SSE streaming headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Build Prompt Contents
      const systemPrompt = `You are MediCore AI, a warm, professional, clinical health records assistant.
You answer the patient's questions grounded strictly in their provided medical report context.

Constraints:
1. Ground all medical answers strictly in the provided report context excerpts.
2. If the context does not contain the answer, politely respond: "I cannot find details about this in your uploaded reports."
3. NEVER make a definitive medical diagnosis. Do not say "You have diabetes", "Your kidneys are failing", or "You are healthy".
4. If parameters are abnormal, explain what the ranges mean in plain English, and include a clear, warm recommendation to consult their doctor.
5. Keep your responses concise, warm, and highly structured. Always remind the patient that your guidance is for informational insights only.`;

      const promptContents = [
        {
          role: "user",
          parts: [
            {
              text: `Medical Context Excerpts:\n${contextText}\n\nRecent History:\n${formattedHistory}\n\nPatient Query: ${query}`,
            },
          ],
        },
      ];

      // Call streaming generator
      const stream = await generateChatStream(promptContents, systemPrompt);

      let completeText = "";

      // Write tokens to stream in real-time
      for await (const chunk of stream) {
        const text = chunk.text || "";
        completeText += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }

      // Safety scanner: checks for potential diagnostic language on final output
      const diagnosticRegex = /\b(diagnose|you have|suffer from|affected by|contracted|positive for)\b/i;
      const requiresSafetyNotice = diagnosticRegex.test(completeText);

      if (requiresSafetyNotice) {
        const safetyWarning = "\n\n*Important Disclaimer: MediCore AI detected diagnostic phrasing. Please remember this information is for educational insights only. Consult a medical professional for clinical decisions.*";
        completeText += safetyWarning;
        res.write(`data: ${JSON.stringify({ text: safetyWarning })}\n\n`);
      }

      // Save Assistant Message
      await prisma.chatMessage.create({
        data: {
          sessionId,
          role: ChatRole.ASSISTANT,
          content: completeText,
          citations: citations as any,
        },
      });

      // Stream closure indicator
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      next(err);
    }
  }

  // ─── Doctor endpoint: patient AI Brief ──────────────────────────────────────

  static async getPatientBrief(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = p(req.params.id);

      const doctor = await prisma.doctor.findUnique({
        where: { userId: req.user!.id },
      });
      if (!doctor) {
        throw new AppError(404, "Doctor profile not found", "DOCTOR_NOT_FOUND");
      }

      // Verify connection is APPROVED
      const link = await prisma.patientDoctorLink.findFirst({
        where: {
          patientId,
          doctorId: doctor.id,
          status: "APPROVED",
        },
      });
      if (!link) {
        throw new AppError(403, "You do not have access to this patient profile", "ACCESS_DENIED");
      }

      // Fetch patient's recent records to construct a summary brief
      const aiResults = await prisma.recordAIResult.findMany({
        where: {
          record: {
            patientId,
            deletedAt: null,
          },
        },
        orderBy: { processedAt: "desc" },
        take: 3,
        select: { clinicalSummary: true, summaryText: true, processedAt: true },
      });

      if (aiResults.length === 0) {
        return res.status(200).json({
          success: true,
          data: { brief: "No medical reports uploaded by patient yet." },
        });
      }

      // Compile summaries
      const combinedSummaries = aiResults
        .map((r, i) => `Report [${i + 1}] (${r.processedAt.toLocaleDateString()}): ${r.clinicalSummary || r.summaryText}`)
        .join("\n\n");

      // Generate brief
      const systemInstruction = `You are a clinical database summarizer. Generate a structured 5-bullet patient clinical brief for the doctor. Focus strictly on chronic issues, abnormal values, and recent test directions. Make it highly concise.`;
      const prompt = `Patient Summary Excerpts:\n${combinedSummaries}\n\nGenerate the 5-bullet brief now.`;

      // Call RAG stream wrapper synchronous fallback
      const stream = await generateChatStream([{ role: "user", parts: [{ text: prompt }] }], systemInstruction);
      let responseText = "";
      for await (const chunk of stream) {
        responseText += chunk.text || "";
      }

      res.status(200).json({
        success: true,
        data: { brief: responseText.trim() },
      });
    } catch (err) {
      next(err);
    }
  }
}
