import "server-only";
import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { _prisma?: PrismaClient };
export const db = g._prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g._prisma = db;
