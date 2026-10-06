import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getStockRows } from "@/server/services/inventory";
import { PageHeader, Card, Badge } from "@/components/ui";
import { money, num, pct } from "@/lib/format";

export const metadata = { title: "Reportes" };
const DAY = 86400000;

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-line-200 p-3">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`num text-[20px] font-bold ${tone === "bad" ? "text-danger" : tone === "good" ? "text-success" : ""}`}>{value}</div>
      {hint && <div className="text-[11px] text-ink-500">{hint}</div>}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { ctx } = await requireSession("reportes");
  const days = [30, 60, 90].includes(Number((await searchParams).d)) ? Number((await searchParams).d) : 90;
  const O = ctx.orgId;
  const since = new Date(Date.now() - days * DAY);
  const [rows, orders, quotes, receipts, saleMovs] = await Promise.all([
    getStockRows(O),
    prisma.salesOrder.findMany({ where: { organizationId: O, createdAt: { gte: since }, status: { not: "CANCELLED" } }, include: { items: { include: { product: { include: { category: true } } } }, customer: true } }),
    prisma.quotation.findMany({ where: { organizationId: O, issueDate: { gte: since } }, select: { status: true } }),
    prisma.goodsReceipt.findMany({ where: { organizationId: O, receivedAt: { gte: since } }, include: { purchaseOrder: { include: { supplier: true } } } }),
    prisma.inventoryMovement.findMany({ where: { organizationId: O, movementType: "SALE", createdAt: { gte: since } }, select: { totalCost: true } }),
  ]);
  const invValue = rows.reduce((s, r) => s + r.onHand * r.averageCost, 0);
  const cogs = saleMovs.reduce((s, m) => s + m.totalCost, 0);
  const dailyCogs = cogs / days;
  const revenue = orders.reduce((s, o) => s + o.subtotal, 0);
  const cost = orders.reduce((s, o) => s + o.items.reduce((a, i) => a + i.unitCost * i.quantity, 0), 0);
  const out = rows.filter((r) => r.status === "OUT_OF_STOCK").length;
  const open = orders.filter((o) => ["CONFIRMED", "PREPARING", "READY", "PARTIAL"].includes(o.status));
  const incomplete = open.filter((o) => o.items.some((i) => i.quantity > i.reservedQuantity + i.fulfilledQuantity)).length;
  const decided = quotes.filter((q) => ["CONVERTED", "REJECTED", "EXPIRED"].includes(q.status));
  const converted = quotes.filter((q) => q.status === "CONVERTED").length;
  const onTime = receipts.filter((r) => !r.purchaseOrder.expectedDate || r.receivedAt <= new Date(r.purchaseOrder.expectedDate.getTime() + DAY)).length;
  const customers = new Set(orders.map((o) => o.customerId)).size;
  const lines = orders.reduce((s, o) => s + o.items.length, 0);

  // Ventas por categoría y clasificación ABC
  const byCat = new Map<string, number>();
  const byProduct = new Map<string, { name: string; revenue: number }>();
  for (const o of orders) for (const i of o.items) {
    const c = i.product.category?.name ?? "Sin categoría";
    byCat.set(c, (byCat.get(c) ?? 0) + i.subtotal);
    const e = byProduct.get(i.productId) ?? { name: i.product.name, revenue: 0 };
    e.revenue += i.subtotal;
    byProduct.set(i.productId, e);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map((c) => c[1]));
  const ranked = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue);
  let acc = 0;
  const abc = ranked.map((p) => { acc += p.revenue; const share = acc / Math.max(1, revenue); return { ...p, cls: share <= 0.8 ? "A" : share <= 0.95 ? "B" : "C" }; });

  // Ventas por mes
  const byMonth = new Map<string, { revenue: number; orders: number }>();
  for (const o of orders) {
    const k = new Date(o.createdAt.getTime() - 5 * 3600000).toISOString().slice(0, 7);
    const e = byMonth.get(k) ?? { revenue: 0, orders: 0 };
    e.revenue += o.total; e.orders++;
    byMonth.set(k, e);
  }

  return (
    <div>
      <PageHeader title="Reportes" subtitle="Indicadores operativos y comerciales (PRD §40)" actions={
        <div className="flex gap-1 rounded-lg border border-line-200 bg-white p-1 text-[13px]">{[30, 60, 90].map((d) => <a key={d} href={`?d=${d}`} className={`rounded-md px-2.5 py-1 font-medium ${d === days ? "bg-brand-600 text-white" : "hover:bg-surface-100"}`}>{d} días</a>)}</div>
      } />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Operativos">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Tasa de quiebre de stock" value={pct((out / Math.max(1, rows.length)) * 100)} hint={`${out} de ${rows.length} productos`} tone={out ? "bad" : "good"} />
            <Metric label="Días de inventario" value={dailyCogs ? num(invValue / dailyCogs, 0) : "—"} hint="Valor inventario / costo de venta diario" />
            <Metric label="Rotación (anualizada)" value={invValue ? num((cogs / invValue) * (365 / days), 1) : "—"} hint="Costo de ventas / inventario" />
            <Metric label="Pedidos incompletos" value={pct(open.length ? (incomplete / open.length) * 100 : 0)} hint={`${incomplete} de ${open.length} abiertos`} tone={incomplete ? "bad" : "good"} />
            <Metric label="Cumplimiento proveedores" value={receipts.length ? pct((onTime / receipts.length) * 100) : "—"} hint={`${receipts.length} recepciones`} />
            <Metric label="Inventario valorizado" value={money(invValue)} />
          </div>
        </Card>
        <Card title="Comerciales">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Conversión cotización → pedido" value={decided.length ? pct((converted / decided.length) * 100) : "—"} hint={`${converted} de ${decided.length} decididas`} />
            <Metric label="Ticket promedio" value={money(orders.length ? revenue / orders.length : 0)} hint="Antes de IVA" />
            <Metric label="Margen bruto" value={revenue ? pct(((revenue - cost) / revenue) * 100) : "—"} hint={money(revenue - cost)} tone="good" />
            <Metric label="Ventas por cliente" value={money(customers ? revenue / customers : 0)} hint={`${customers} clientes activos`} />
            <Metric label="Productos por venta" value={num(orders.length ? lines / orders.length : 0, 1)} />
            <Metric label="Ventas del periodo" value={money(revenue)} hint={`${orders.length} pedidos`} />
          </div>
        </Card>
        <Card title="Ventas por categoría">
          <ul className="space-y-3">
            {cats.map(([c, v]) => (
              <li key={c} className="text-[13px]">
                <div className="mb-1 flex justify-between"><span>{c}</span><span className="num font-medium">{money(v)}</span></div>
                <div className="h-2 rounded-full bg-surface-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${(v / maxCat) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Ventas por mes" bodyClassName="overflow-x-auto">
          <table className="table"><thead><tr><th>Mes</th><th className="text-right">Pedidos</th><th className="text-right">Ventas (con IVA)</th></tr></thead><tbody>
            {[...byMonth.entries()].sort().map(([m, v]) => <tr key={m}><td>{m}</td><td className="num text-right">{v.orders}</td><td className="num text-right font-medium">{money(v.revenue)}</td></tr>)}
          </tbody></table>
        </Card>
        <Card title="Clasificación ABC de productos (por ventas)" className="xl:col-span-2" bodyClassName="overflow-x-auto">
          <table className="table"><thead><tr><th>Clase</th><th>Producto</th><th className="text-right">Ventas</th><th className="text-right">Participación</th></tr></thead><tbody>
            {abc.map((p) => <tr key={p.name}><td><Badge tone={p.cls === "A" ? "success" : p.cls === "B" ? "warning" : "neutral"}>{p.cls}</Badge></td><td>{p.name}</td><td className="num text-right">{money(p.revenue)}</td><td className="num text-right">{pct((p.revenue / Math.max(1, revenue)) * 100)}</td></tr>)}
          </tbody></table>
        </Card>
      </div>
    </div>
  );
}
