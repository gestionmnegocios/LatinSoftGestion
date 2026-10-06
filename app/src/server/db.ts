import { PrismaClient, Prisma } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

export type Tx = Prisma.TransactionClient;

/** Contexto de ejecución: todo servicio opera dentro de un tenant y un usuario. */
export type Ctx = {
  orgId: string;
  userId: string | null;
  userName: string;
  permissions: Set<string>;
  warehouseId: string;
};

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export function requirePermission(ctx: Ctx, permission: string) {
  if (!ctx.permissions.has("*") && !ctx.permissions.has(permission)) {
    throw new DomainError(`No tiene permiso para esta acción (${permission}).`);
  }
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Búsqueda parcial sin distinguir mayúsculas (PostgreSQL ILIKE). */
export function ilike(value: string) {
  return { contains: value, mode: "insensitive" as const };
}
