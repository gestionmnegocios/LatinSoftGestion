import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { apiSession } from "@/server/api";
import { getStockRows } from "@/server/services/inventory";
import { saveProduct, PRODUCT_CSV_COLUMNS } from "@/server/services/catalog";
import { DomainError } from "@/server/db";

// GET /api/products            → JSON con existencias consolidadas
// GET /api/products?format=csv → exportación (mismo formato que acepta Importar)
export async function GET(req: NextRequest) {
  const { s, error } = await apiSession("inventory.view");
  if (error) return error;
  const rows = await getStockRows(s.ctx.orgId);
  if (req.nextUrl.searchParams.get("format") === "csv") {
    const products = await prisma.product.findMany({ where: { organizationId: s.ctx.orgId }, include: { category: true }, orderBy: { sku: "asc" } });
    const stock = new Map(rows.map((r) => [r.productId, r]));
    const esc = (v: unknown) => { const t = String(v ?? ""); return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const header = [...PRODUCT_CSV_COLUMNS, "onHand", "reserved", "available", "status"];
    const lines = products.map((p) => {
      const r = stock.get(p.id);
      return [p.sku, p.barcode, p.name, p.category?.name, p.unit, p.taxRate, p.averageCost, p.salePrice, p.minimumStock, p.maximumStock, p.safetyStock, r?.onHand ?? 0, r?.reserved ?? 0, r?.available ?? 0, r?.status ?? ""].map(esc).join(",");
    });
    return new NextResponse("﻿" + [header.join(","), ...lines].join("\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="productos-${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  }
  return NextResponse.json({ data: rows });
}

// POST /api/products → crea un producto (valida con Zod en el servicio)
export async function POST(req: NextRequest) {
  const { s, error } = await apiSession("products.manage");
  if (error) return error;
  try {
    const p = await saveProduct(s.ctx, await req.json());
    return NextResponse.json({ data: p }, { status: 201 });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
