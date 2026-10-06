import Link from "next/link";
import { requireSession, can } from "@/server/auth";
import { prisma } from "@/server/db";
import { getStockRows } from "@/server/services/inventory";
import { PageHeader, StatusBadge, KpiCard } from "@/components/ui";
import { AdjustButton } from "@/components/AdjustForm";
import { money, num, STOCK_STATUS } from "@/lib/format";
import { matches } from "@/lib/text";
import { Package, Lock, CheckCircle2, Truck } from "lucide-react";

export const metadata = { title: "Existencias" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession("inventario");
  const { q } = await searchParams;
  const rows = (await getStockRows(s.ctx.orgId, s.ctx.warehouseId)).filter((r) => !q || matches(r.name, q) || matches(r.sku, q));
  const allBalances = await prisma.inventoryBalance.findMany({ where: { organizationId: s.ctx.orgId } });
  const byProduct = new Map<string, Record<string, { onHand: number; reserved: number }>>();
  for (const b of allBalances) {
    const m = byProduct.get(b.productId) ?? {};
    m[b.warehouseId] = { onHand: b.onHand, reserved: b.reserved };
    byProduct.set(b.productId, m);
  }
  const wh = s.warehouses.find((w) => w.id === s.ctx.warehouseId);
  const showCost = can(s, "finance.view_cost");
  const canAdjust = can(s, "inventory.adjust");
  const totals = rows.reduce((a, r) => ({ value: a.value + r.onHand * r.averageCost, reserved: a.reserved + r.reserved * r.averageCost, available: a.available + Math.max(0, r.available) * r.averageCost, incoming: a.incoming + r.incoming * r.averageCost }), { value: 0, reserved: 0, available: 0, incoming: 0 });

  return (
    <div>
      <PageHeader title="Existencias" subtitle={`Bodega ${wh?.name} · Disponible = Físico − Comprometido · Proyectado = Disponible + En tránsito`} />
      {showCost && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Inventario valorizado" value={money(totals.value)} icon={Package} tone="green" />
          <KpiCard label="Comprometido en pedidos" value={money(totals.reserved)} icon={Lock} tone="orange" />
          <KpiCard label="Disponible para vender" value={money(totals.available)} icon={CheckCircle2} tone="blue" />
          <KpiCard label="En tránsito (OC)" value={money(totals.incoming)} icon={Truck} tone="purple" />
        </div>
      )}
      <form className="mb-4 max-w-sm"><input name="q" defaultValue={q} className="input" placeholder="Buscar producto o SKU…" /></form>
      <div className="card overflow-x-auto">
        <table className="table min-w-[960px]">
          <thead><tr><th>SKU</th><th>Producto</th><th className="text-right">Físico</th><th className="text-right">Comprometido</th><th className="text-right">Disponible</th><th className="text-right">En tránsito</th><th className="text-right">Proyectado</th><th className="text-right">Mín / Máx</th>{showCost && <th className="text-right">Valorizado</th>}<th>Estado</th>{canAdjust && <th />}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId}>
                <td className="font-mono text-xs">{r.sku}</td>
                <td><Link href={`/inventario/productos/${r.productId}`} className="font-medium hover:text-brand-600">{r.name}</Link></td>
                <td className="num text-right">{num(r.onHand)}</td>
                <td className="num text-right">{num(r.reserved)}</td>
                <td className="num text-right font-semibold">{num(r.available)}</td>
                <td className="num text-right">{num(r.incoming)}</td>
                <td className="num text-right">{num(r.projected)}</td>
                <td className="num text-right text-ink-500">{num(r.minimumStock)} / {r.maximumStock ? num(r.maximumStock) : "—"}</td>
                {showCost && <td className="num text-right">{money(r.onHand * r.averageCost)}</td>}
                <td><StatusBadge map={STOCK_STATUS} value={r.status} /></td>
                {canAdjust && <td><AdjustButton productId={r.productId} productName={r.name} warehouses={s.warehouses} defaultWarehouseId={s.ctx.warehouseId} balances={byProduct.get(r.productId) ?? {}} className="btn-ghost px-2 py-1 text-xs" /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
