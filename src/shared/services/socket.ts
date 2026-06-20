import { Server as SocketIOServer } from "socket.io";
import { Server as HttpServer } from "http";
import { logger } from "../../config/logger";
import { env } from "../../config/env";

let io: SocketIOServer | null = null;

export function initSocketServer(server: HttpServer) {
  const allowedOrigins = [env.FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"];

  io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    logger.info(`🔌 Socket client connected: ${socket.id}`);

    // Client joins their personal room: user:userId (userId will be standard User.id)
    socket.on("join-room", (userId: string) => {
      if (userId) {
        socket.join(`user:${userId}`);
        logger.info(`👥 Client ${socket.id} joined room user:${userId}`);
      }
    });

    socket.on("disconnect", () => {
      logger.info(`🔌 Socket client disconnected: ${socket.id}`);
    });
  });

  logger.info("📡 Socket.io server initialized successfully");
  return io;
}

export function getSocketServer(): SocketIOServer {
  if (!io) {
    throw new Error("Socket.io server has not been initialized yet!");
  }
  return io;
}

export function emitToUser(userId: string, event: string, data: any) {
  try {
    const server = getSocketServer();
    server.to(`user:${userId}`).emit(event, data);
    logger.info(`📤 Sent WebSocket event '${event}' to user:${userId}`);
  } catch (error: any) {
    logger.error(`❌ Failed to emit WebSocket event '${event}' to user:${userId}:`, error.message);
  }
}
