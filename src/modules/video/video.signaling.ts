import { Server as SocketIOServer, Socket } from "socket.io";
import { logger } from "../../config/logger";
import { prisma } from "../../config/prisma";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { AppointmentStatus } from "@prisma/client";

export function setupVideoSignaling(io: SocketIOServer) {
  const videoNamespace = io.of("/video");

  videoNamespace.on("connection", (socket: Socket) => {
    logger.info(`🔌 Video Socket client connected: ${socket.id}`);

    socket.on("video:join", async (data: { appointmentId: string; token: string }) => {
      const { appointmentId, token } = data;
      try {
        // 1. Verify access token
        let decoded: any;
        try {
          decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
        } catch {
          socket.emit("video:error", { message: "Invalid authorization token" });
          return;
        }

        const userId = decoded.sub;

        // 2. Fetch appointment details
        const appointment = await prisma.appointment.findUnique({
          where: { id: appointmentId },
          include: { videoSession: true, patient: true, doctor: true },
        });

        if (!appointment || !appointment.videoSession) {
          socket.emit("video:error", { message: "Appointment or video session not found" });
          return;
        }

        const isUserParticipant =
          appointment.patient.userId === userId || appointment.doctor.userId === userId;

        if (!isUserParticipant) {
          socket.emit("video:error", { message: "Unauthorized access to video room" });
          return;
        }

        const roomName = `room:${appointment.videoSession.roomId}`;
        socket.join(roomName);
        logger.info(`👥 Video client ${socket.id} (user:${userId}) joined ${roomName}`);

        // Set variables on socket connection
        (socket as any).appointmentId = appointmentId;
        (socket as any).roomId = appointment.videoSession.roomId;
        (socket as any).userId = userId;

        // 3. Update session and appointment status if WAITING
        if (appointment.videoSession.status === "WAITING") {
          await prisma.videoSession.update({
            where: { appointmentId },
            data: { status: "ACTIVE", startedAt: new Date() },
          });

          await prisma.appointment.update({
            where: { id: appointmentId },
            data: { status: AppointmentStatus.IN_PROGRESS },
          });
        }

        // 4. Notify peer
        socket.to(roomName).emit("video:peer-joined", { userId });
      } catch (err: any) {
        logger.error(`Error during video join session: ${err.message}`);
        socket.emit("video:error", { message: "Error joining video consultation session" });
      }
    });

    socket.on("video:offer", (data: { sdp: any }) => {
      const roomId = (socket as any).roomId;
      if (roomId) {
        socket.to(`room:${roomId}`).emit("video:offer", { sdp: data.sdp });
      }
    });

    socket.on("video:answer", (data: { sdp: any }) => {
      const roomId = (socket as any).roomId;
      if (roomId) {
        socket.to(`room:${roomId}`).emit("video:answer", { sdp: data.sdp });
      }
    });

    socket.on("video:ice-candidate", (data: { candidate: any }) => {
      const roomId = (socket as any).roomId;
      if (roomId) {
        socket.to(`room:${roomId}`).emit("video:ice-candidate", { candidate: data.candidate });
      }
    });

    socket.on("video:leave", async () => {
      await handleLeave(socket);
    });

    socket.on("disconnect", async () => {
      logger.info(`🔌 Video socket disconnected: ${socket.id}`);
      await handleLeave(socket);
    });
  });
}

async function handleLeave(socket: Socket) {
  const roomId = (socket as any).roomId;
  const appointmentId = (socket as any).appointmentId;
  const userId = (socket as any).userId;

  if (roomId && appointmentId) {
    socket.to(`room:${roomId}`).emit("video:peer-left", { userId });
    socket.leave(`room:${roomId}`);
    logger.info(`👥 Video client ${socket.id} left room:${roomId}`);

    delete (socket as any).roomId;
    delete (socket as any).appointmentId;
    delete (socket as any).userId;
  }
}
