import { Prisma } from "@prisma/client";
import { prisma } from "./db";

/** Tablas y columnas habilitadas para búsqueda de texto (lista blanca: los nombres van a SQL). */
const SEARCHABLE = {
  Product: ["name", "sku", "barcode"],
  Customer: ["name", "tradeName", "documentNumber", "contactName"],
  Supplier: ["legalName", "tradeName", "taxId"],
  Quotation: ["number"],
  SalesOrder: ["number"],
  PurchaseOrder: ["number"],
  Invoice: ["number"],
} as const;

export type SearchTable = keyof typeof SEARCHABLE;

/**
 * Ids de la organización cuyas columnas contienen `query`, ignorando tildes y mayúsculas
 * (f_unaccent + ILIKE, ver migración busqueda_sin_tildes). Úselo como `id: { in: ids }`.
 */
export async function searchIds(table: SearchTable, orgId: string, query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const conditions = SEARCHABLE[table].map(
    (col) => Prisma.sql`f_unaccent(${Prisma.raw(`"${col}"`)}) ILIKE f_unaccent(${pattern})`,
  );
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE "organizationId" = ${orgId} AND (${Prisma.join(conditions, " OR ")}) LIMIT 500`,
  );
  return rows.map((r) => r.id);
}
