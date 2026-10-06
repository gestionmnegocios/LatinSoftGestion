import { NextResponse, type NextRequest } from "next/server";
import { apiSession } from "@/server/api";
import { getStockRows } from "@/server/services/inventory";

// GET /api/inventory?status=LOW|OUT_OF_STOCK&warehouse=<id>
// No existe PATCH de cantidad: el inventario solo cambia mediante movimientos (ajustes, recepciones, despachos).
export async function GET(req: NextRequest) {
  const { s, error } = await apiSession("inventory.view");
  if (error) return error;
  const wh = req.nextUrl.searchParams.get("warehouse") ?? s.ctx.warehouseId;
  if (!s.warehouses.some((w) => w.id === wh)) return NextResponse.json({ error: "warehouse_not_found" }, { status: 404 });
  const status = req.nextUrl.searchParams.get("status");
  const rows = (await getStockRows(s.ctx.orgId, wh)).filter((r) => !status || r.status === status);
  return NextResponse.json({ warehouseId: wh, data: rows });
}
