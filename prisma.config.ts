import { defineConfig } from "prisma/config";
import dotenv from "dotenv";

dotenv.config();

// prisma.config.ts is used by the Prisma CLI (migrate, generate, studio).
// PrismaClient runtime connection is configured via the adapter in src/config/prisma.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // DIRECT_URL bypasses the connection pooler — required for DDL statements in migrations
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
});
