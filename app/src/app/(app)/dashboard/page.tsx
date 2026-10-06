import Link from "next/link";
import { ShoppingCart, FileText, ClipboardList, Package, AlertTriangle, XCircle, ShoppingBag, Wallet, Bot, CircleAlert, Clock, CircleX, Truck } from "lucide-react";
import { requireSession } from "@/server/auth";
import { MODULE_ACCESS, hasAny } from "@/server/permissions";
import { prisma } from "@/server/db";
import { getStockRows } from "@/server/services/inventory";
import { getCopilotHighlights } from "@/server/ai/copilot";
import { KpiCard, Card, StatusBadge, Empty } from "@/components/ui";
import { SalesChart } from "@/components/SalesChart";
import { AskBox } from "@/components/AskBox";
import { money, num, shortDate, date, STOCK_STATUS, ORDER_STATUS, PO_STATUS } from "@/lib/format";

export const metadata = { title: "Dashboard" };
const DAY = 86400000;

function bogotaDayKey(d: Date) {
  return new Date(d.getTime() - 5 * 3600000).toISOString().slice(0, 10);
}

export default async function Dashboard() {
  const s = await requireSession();
  const ctx = s.ctx;
  const canBuy = hasAny(ctx.permissions, MODULE_ACCESS.compras);
  const O = ctx.orgId;
  const now = new Date();
  const todayKey = bogotaDayKey(now);
  const startToday = new Date(`${todayKey}T05:00:00.000Z`);
  const since30 = new Date(startToday.getTime() - 29 * DAY);
  const since60 = new Date(startToday.getTime() - 59 * DAY);

  const [orders60, quotes30, openQuotes, pendingOrders, pendingPOs, receivables, rows, highlights, soldItems] = await Promise.all([
    prisma.salesOrder.findMany({ where: { organizationId: O, createdAt: { gte: since60 }, status: { not: "CANCELLED" } }, select: { createdAt: true, total: true } }),
    prisma.quotation.findMany({ where: { organizationId: O, issueDate: { gte: since30 } }, select: { issueDate: true, total: true } }),
    prisma.quotation.count({ where: { organizationId: O, status: { in: ["DRAFT", "SENT"] } } }),
    prisma.salesOrder.findMany({ where: { organizationId: O, status: { in: ["CONFIRMED", "PREPARING", "READY", "PARTIAL"] } }, include: { customer: true, items: true }, orderBy: { createdAt: "asc" } }),
    prisma.purchaseOrder.findMany({ where: { organizationId: O, status: { in: ["SENT", "CONFIRMED", "IN_TRANSIT", "PARTIALLY_RECEIVED"] } }, include: { supplier: true }, orderBy: { expectedDate: "asc" } }),
    prisma.invoice.findMany({ where: { organizationId: O, status: { in: ["ISSUED", "PARTIAL"] } }, select: { total: true, paidAmount: true, dueDate: true } }),
    getStockRows(O, ctx.warehouseId),
    getCopilotHighlights(ctx),
    prisma.salesOrderItem.groupBy({
      by: ["productId"],
      where: { salesOrder: { organizationId: O, createdAt: { gte: since30 }, status: { not: "CANCELLED" } } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
  ]);

  const salesToday = orders60.filter((o) => bogotaDayKey(o.createdAt) === todayKey).reduce((s, o) => s + o.total, 0);
  const sameDayLastWeek = bogotaDayKey(new Date(now.getTime() - 7 * DAY));
  const salesLastWeek = orders60.filter((o) => bogotaDayKey(o.createdAt) === sameDayLastWeek).reduce((s, o) => s + o.total, 0);
  const sales30 = orders60.filter((o) => o.createdAt >= since30).reduce((s, o) => s + o.total, 0);
  const salesPrev30 = orders60.filter((o) => o.createdAt < since30).reduce((s, o) => s + o.total, 0);
  const trend = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);

  const valued = rows.reduce((s, r) => s + r.onHand * r.averageCost, 0);
  const low = rows.filter((r) => r.status === "LOW");
  const out = rows.filter((r) => r.status === "OUT_OF_STOCK");
  const purchasesPending = pendingPOs.reduce((s, p) => s + p.total, 0);
  const receivable = receivables.reduce((s, i) => s + i.total - i.paidAmount, 0);
  const overdue = receivables.filter((i) => i.dueDate < now).reduce((s, i) => s + i.total - i.paidAmount, 0);

  const chart: { day: string; ventas: number; cotizaciones: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(startToday.getTime() - i * DAY + 12 * 3600000);
    const key = bogotaDayKey(d);
    chart.push({
      day: shortDate(d),
      ventas: orders60.filter((o) => bogotaDayKey(o.createdAt) === key).reduce((s, o) => s + o.total, 0),
      cotizaciones: quotes30.filter((q) => bogotaDayKey(q.issueDate) === key).reduce((s, q) => s + q.total, 0),
    });
  }

  const productNames = new Map(rows.map((r) => [r.productId, r.name]));
  const top = soldItems.map((s) => ({ name: productNames.get(s.productId) ?? "—", qty: s._sum.quantity ?? 0 }));
  const maxTop = Math.max(1, ...top.map((t) => t.qty));
  const critical = [...out, ...low].slice(0, 7);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Dashboard</h1>
        <p className="text-[13px] text-ink-500">Resumen general de tu negocio · {date(now)}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Ventas hoy" value={money(salesToday)} icon={ShoppingCart} tone="green" trend={trend(salesToday, salesLastWeek)} href="/ventas/pedidos" />
        <KpiCard label="Cotizaciones abiertas" value={num(openQuotes)} icon={FileText} tone="blue" href="/ventas/cotizaciones?estado=abiertas" hint="Borradores y enviadas" />
        <KpiCard label="Pedidos pendientes" value={num(pendingOrders.length)} icon={ClipboardList} tone="orange" href="/ventas/pedidos?estado=pendientes" hint={`${pendingOrders.filter((o) => o.items.some((i) => i.quantity > i.reservedQuantity + i.fulfilledQuantity)).length} con faltantes`} />
        <KpiCard label="Inventario valorizado" value={money(valued)} icon={Package} tone="green" href="/inventario/existencias" hint="Al costo promedio" />
        <KpiCard label="Stock bajo" value={num(low.length)} icon={AlertTriangle} tone="orange" href="/inventario/alertas" />
        <KpiCard label="Agotados" value={num(out.length)} icon={XCircle} tone="red" href="/inventario/alertas" />
        <KpiCard label="Compras pendientes" value={money(purchasesPending)} icon={ShoppingBag} tone="red" href="/compras/ordenes" hint={`${pendingPOs.length} órdenes abiertas`} />
        <KpiCard label="Cuentas por cobrar" value={money(receivable)} icon={Wallet} tone="blue" href="/finanzas" hint={overdue > 0 ? `${money(overdue)} vencidas` : "Al día"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="card relative overflow-hidden bg-gradient-to-br from-white via-white to-ai-bg p-5">
          <div className="flex gap-4">
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-ai-bg text-ai sm:flex"><Bot size={30} /></div>
            <div className="min-w-0 flex-1">
              <div className="h2 text-navy-800">Copiloto LatinSoft IA</div>
              <div className="mt-2 flex items-center gap-2 text-[16px] font-bold text-navy-900">
                <CircleAlert size={20} className="text-danger" /> {highlights.attention} productos requieren atención
              </div>
              <ul className="mt-2 space-y-1.5 text-[13.5px] text-ink-700">
                <li className="flex items-center gap-2"><Clock size={16} className="text-warning" /> {highlights.soon} podrían agotarse esta semana.</li>
                <li className="flex items-center gap-2"><CircleX size={16} className="text-danger" /> {highlights.out} están agotados.</li>
                <li className="flex items-center gap-2"><AlertTriangle size={16} className="text-warning" /> {highlights.belowMin} están por debajo del stock mínimo.</li>
                {highlights.staleValue > 0 && (
                  <li className="flex items-center gap-2"><Package size={16} className="text-ai" /> {money(highlights.staleValue)} permanecen inmovilizados en {highlights.staleCount} productos de baja rotación.</li>
                )}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/ia?q=Muéstrame productos próximos a agotarse" className="btn-primary">Analizar inventario</Link>
                {canBuy && <Link href="/compras/necesidades" className="btn-primary">Generar compra</Link>}
              </div>
            </div>
          </div>
        </div>
        <div className="card p-5"><AskBox /></div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr_1.2fr]">
        <Card title="Ventas últimos 30 días" actions={<span className="text-xs text-ink-500">{money(sales30)} {trend(sales30, salesPrev30) !== null && <b className={trend(sales30, salesPrev30)! >= 0 ? "text-success" : "text-danger"}>({trend(sales30, salesPrev30)! >= 0 ? "+" : ""}{trend(sales30, salesPrev30)!.toFixed(0)}%)</b>}</span>}>
          <SalesChart data={chart} />
        </Card>
        <Card title="Productos más vendidos" actions={<span className="text-xs text-ink-500">30 días</span>}>
          <ol className="space-y-3">
            {top.map((t, i) => (
              <li key={t.name} className="flex items-center gap-3 text-[13px]">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-100 text-xs font-semibold">{i + 1}</span>
                <span className="w-28 truncate sm:w-36">{t.name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-100"><span className="block h-full rounded-full bg-accent-600" style={{ width: `${(t.qty / maxTop) * 100}%` }} /></span>
                <span className="num w-10 text-right font-semibold">{num(t.qty)}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Inventario crítico" actions={<Link href="/inventario/alertas" className="text-xs font-medium text-brand-600">Ver todos</Link>} bodyClassName="overflow-x-auto">
          {critical.length === 0 ? <Empty>Sin productos críticos</Empty> : (
            <table className="table">
              <thead><tr><th>Producto</th><th className="text-right">Disponible</th><th className="text-right">Mínimo</th><th>Estado</th></tr></thead>
              <tbody>
                {critical.map((r) => (
                  <tr key={r.productId}>
                    <td className="max-w-40 truncate"><Link href={`/inventario/productos/${r.productId}`} className="hover:text-brand-600">{r.name}</Link></td>
                    <td className="num text-right font-semibold text-danger">{num(r.available)}</td>
                    <td className="num text-right">{num(r.minimumStock)}</td>
                    <td><StatusBadge map={STOCK_STATUS} value={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Pedidos pendientes" actions={<Link href="/ventas/pedidos?estado=pendientes" className="text-xs font-medium text-brand-600">Ver todos</Link>} bodyClassName="overflow-x-auto">
          {pendingOrders.length === 0 ? <Empty>No hay pedidos pendientes</Empty> : (
            <table className="table">
              <thead><tr><th>Pedido</th><th>Cliente</th><th className="text-right">Total</th><th>Estado</th></tr></thead>
              <tbody>
                {pendingOrders.slice(0, 6).map((o) => {
                  const short = o.items.some((i) => i.quantity > i.reservedQuantity + i.fulfilledQuantity);
                  return (
                    <tr key={o.id}>
                      <td><Link href={`/ventas/pedidos/${o.id}`} className="font-medium text-brand-600">{o.number}</Link></td>
                      <td className="max-w-44 truncate">{o.customer.name}</td>
                      <td className="num text-right">{money(o.total)}</td>
                      <td className="space-x-1"><StatusBadge map={ORDER_STATUS} value={o.status} />{short && <span className="text-xs font-semibold text-danger">Faltante</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Compras próximas a recibirse" actions={<Link href="/compras/recepciones" className="text-xs font-medium text-brand-600">Recepciones</Link>} bodyClassName="overflow-x-auto">
          {pendingPOs.length === 0 ? <Empty>No hay compras en curso</Empty> : (
            <table className="table">
              <thead><tr><th>OC</th><th>Proveedor</th><th>Entrega</th><th>Estado</th></tr></thead>
              <tbody>
                {pendingPOs.slice(0, 6).map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/compras/ordenes/${p.id}`} className="font-medium text-brand-600">{p.number}</Link></td>
                    <td className="max-w-44 truncate"><Truck size={13} className="mr-1 inline text-ink-500" />{p.supplier.tradeName ?? p.supplier.legalName}</td>
                    <td className={p.expectedDate && p.expectedDate < now ? "font-semibold text-danger" : ""}>{date(p.expectedDate)}</td>
                    <td><StatusBadge map={PO_STATUS} value={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
