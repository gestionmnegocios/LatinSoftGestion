import Link from "next/link";
import { Wallet, ArrowDownCircle, ArrowUpCircle, Receipt, Landmark, TrendingUp } from "lucide-react";
import { requireSession, can } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, Card, KpiCard, Tabs, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { payPayableAction } from "@/app/actions";
import { CashForms } from "./CashForms";
import { money, num, pct, date, dateTime } from "@/lib/format";

export const metadata = { title: "Caja y Finanzas" };
const DAY = 86400000;

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("finanzas");
  const { tab = "resumen" } = await searchParams;
  const O = s.ctx.orgId;
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY);
  const [cashAll, lastClosing, closings, recvOpen, payables, orders30] = await Promise.all([
    prisma.cashMovement.findMany({ where: { organizationId: O }, orderBy: { createdAt: "desc" } }),
    prisma.cashClosing.findFirst({ where: { organizationId: O }, orderBy: { createdAt: "desc" } }),
    prisma.cashClosing.findMany({ where: { organizationId: O }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.invoice.findMany({ where: { organizationId: O, status: { in: ["ISSUED", "PARTIAL"] } }, include: { customer: true }, orderBy: { dueDate: "asc" } }),
    prisma.accountPayable.findMany({ where: { organizationId: O }, orderBy: [{ status: "desc" }, { dueDate: "asc" }], take: 40 }),
    prisma.salesOrder.findMany({ where: { organizationId: O, createdAt: { gte: since30 }, status: { not: "CANCELLED" } }, include: { customer: true, items: { include: { product: true } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const suppliers = new Map((await prisma.supplier.findMany({ where: { organizationId: O } })).map((x) => [x.id, x.tradeName ?? x.legalName]));
  const balance = cashAll.reduce((a, m) => a + (m.type === "IN" ? m.amount : -m.amount), 0);
  const month = cashAll.filter((m) => m.createdAt >= since30);
  const in30 = month.filter((m) => m.type === "IN").reduce((a, m) => a + m.amount, 0);
  const out30 = month.filter((m) => m.type === "OUT").reduce((a, m) => a + m.amount, 0);
  const receivable = recvOpen.reduce((a, i) => a + i.total - i.paidAmount, 0);
  const payable = payables.filter((p) => p.status === "PENDING").reduce((a, p) => a + p.amount - p.paidAmount, 0);
  const revenue = orders30.reduce((a, o) => a + o.subtotal, 0);
  const cost = orders30.reduce((a, o) => a + o.items.reduce((b, i) => b + i.unitCost * i.quantity, 0), 0);
  const sinceClose = cashAll.filter((m) => !lastClosing || m.createdAt > lastClosing.createdAt);
  const expected = (lastClosing?.counted ?? 0) + sinceClose.reduce((a, m) => a + (m.type === "IN" ? m.amount : -m.amount), 0);

  const byProduct = new Map<string, { name: string; revenue: number; cost: number; qty: number }>();
  for (const o of orders30) for (const i of o.items) {
    const e = byProduct.get(i.productId) ?? { name: i.product.name, revenue: 0, cost: 0, qty: 0 };
    e.revenue += i.subtotal; e.cost += i.unitCost * i.quantity; e.qty += i.quantity;
    byProduct.set(i.productId, e);
  }
  const prodRows = [...byProduct.values()].sort((a, b) => (b.revenue - b.cost) - (a.revenue - a.cost));
  const showCost = can(s, "finance.view_cost");
  const tabs = [
    { key: "resumen", label: "Resumen", href: "?tab=resumen" },
    { key: "caja", label: "Caja", href: "?tab=caja" },
    { key: "cxc", label: "Cuentas por cobrar", href: "?tab=cxc" },
    { key: "cxp", label: "Cuentas por pagar", href: "?tab=cxp" },
    ...(showCost ? [{ key: "rentabilidad", label: "Rentabilidad", href: "?tab=rentabilidad" }] : []),
  ];

  return (
    <div>
      <PageHeader title="Caja y Finanzas" subtitle="Ingresos, egresos, cierres, cartera, cuentas por pagar y márgenes" />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Saldo en caja" value={money(balance)} icon={Wallet} tone="green" />
        <KpiCard label="Ingresos 30 días" value={money(in30)} icon={ArrowDownCircle} tone="blue" />
        <KpiCard label="Egresos 30 días" value={money(out30)} icon={ArrowUpCircle} tone="red" />
        <KpiCard label="Por cobrar" value={money(receivable)} icon={Receipt} tone="orange" />
        <KpiCard label="Por pagar" value={money(payable)} icon={Landmark} tone="purple" />
        {showCost && <KpiCard label="Margen bruto 30 d" value={revenue ? pct(((revenue - cost) / revenue) * 100) : "—"} icon={TrendingUp} tone="green" hint={money(revenue - cost)} />}
      </div>
      <div className="mb-4"><Tabs active={tab} tabs={tabs} /></div>

      {tab === "resumen" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Flujo de caja (últimos movimientos)" bodyClassName="overflow-x-auto">
            <table className="table"><thead><tr><th>Fecha</th><th>Concepto</th><th className="text-right">Valor</th></tr></thead><tbody>
              {cashAll.slice(0, 10).map((m) => <tr key={m.id}><td className="whitespace-nowrap">{date(m.createdAt)}</td><td>{m.concept}</td><td className={`num text-right font-medium ${m.type === "IN" ? "text-success" : "text-danger"}`}>{m.type === "IN" ? "+" : "−"}{money(m.amount)}</td></tr>)}
            </tbody></table>
          </Card>
          <Card title="Cartera por vencimiento" bodyClassName="overflow-x-auto">
            <table className="table"><thead><tr><th>Rango</th><th className="text-right">Facturas</th><th className="text-right">Saldo</th></tr></thead><tbody>
              {[["Al día", (d: number) => d <= 0], ["1-30 días vencida", (d: number) => d > 0 && d <= 30], ["31-60 días", (d: number) => d > 30 && d <= 60], ["Más de 60 días", (d: number) => d > 60]].map(([label, test]) => {
                const list = recvOpen.filter((i) => (test as (d: number) => boolean)((now.getTime() - i.dueDate.getTime()) / DAY));
                return <tr key={label as string}><td>{label as string}</td><td className="num text-right">{list.length}</td><td className="num text-right font-medium">{money(list.reduce((a, i) => a + i.total - i.paidAmount, 0))}</td></tr>;
              })}
            </tbody></table>
          </Card>
        </div>
      )}

      {tab === "caja" && (
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <Card title="Movimientos de caja" bodyClassName="overflow-x-auto max-h-[600px]">
            <table className="table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th className="text-right">Valor</th></tr></thead><tbody>
              {cashAll.slice(0, 60).map((m) => <tr key={m.id}><td className="whitespace-nowrap">{dateTime(m.createdAt)}</td><td>{m.concept}</td><td>{m.type === "IN" ? <Badge tone="success">Ingreso</Badge> : <Badge tone="danger">Egreso</Badge>}</td><td className="num text-right">{money(m.amount)}</td></tr>)}
            </tbody></table>
          </Card>
          <div className="space-y-4">
            {can(s, "finance.cash") ? <CashForms expected={expected} /> : <Card><p className="text-ink-500">Su rol no gestiona caja.</p></Card>}
            <Card title="Últimos cierres">
              {closings.length === 0 ? <p className="text-[13px] text-ink-500">Sin cierres registrados.</p> : (
                <ul className="space-y-2 text-[13px]">{closings.map((c) => <li key={c.id} className="flex justify-between"><span>{dateTime(c.createdAt)}</span><span className={c.difference === 0 ? "text-success" : "text-danger"}>{money(c.counted)} ({c.difference >= 0 ? "+" : ""}{money(c.difference)})</span></li>)}</ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "cxc" && (
        <div className="card overflow-x-auto">
          <table className="table min-w-[700px]"><thead><tr><th>Factura</th><th>Cliente</th><th>Vence</th><th className="text-right">Días</th><th className="text-right">Saldo</th></tr></thead><tbody>
            {recvOpen.map((i) => { const d = Math.floor((now.getTime() - i.dueDate.getTime()) / DAY); return <tr key={i.id}><td><Link href={`/ventas/facturas/${i.id}`} className="text-brand-600">{i.number}</Link></td><td>{i.customer.name}</td><td>{date(i.dueDate)}</td><td className={`num text-right ${d > 0 ? "font-semibold text-danger" : "text-ink-500"}`}>{d > 0 ? `${d} vencida` : `${-d} por vencer`}</td><td className="num text-right font-medium">{money(i.total - i.paidAmount)}</td></tr>; })}
          </tbody></table>
        </div>
      )}

      {tab === "cxp" && (
        <div className="card overflow-x-auto">
          <table className="table min-w-[760px]"><thead><tr><th>Proveedor</th><th>Documento</th><th>Vence</th><th className="text-right">Valor</th><th>Estado</th></tr></thead><tbody>
            {payables.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/proveedores/${p.supplierId}`} className="hover:text-brand-600">{suppliers.get(p.supplierId)}</Link></td>
                <td className="text-xs">{p.documentNumber}</td>
                <td className={p.status === "PENDING" && p.dueDate < now ? "font-semibold text-danger" : ""}>{date(p.dueDate)}</td>
                <td className="num text-right">{money(p.amount)}</td>
                <td>{p.status === "PAID" ? <Badge tone="success">Pagada</Badge> : can(s, "finance.pay") ? <ActionButton className="btn-ghost px-2 py-1 text-xs" confirm={`¿Registrar egreso de ${money(p.amount - p.paidAmount)}?`} action={payPayableAction.bind(null, p.id)} success="Pago a proveedor registrado.">Pagar</ActionButton> : <Badge tone="warning">Pendiente</Badge>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      {tab === "rentabilidad" && showCost && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Rentabilidad por producto (30 días)" bodyClassName="overflow-x-auto">
            <table className="table"><thead><tr><th>Producto</th><th className="text-right">Und.</th><th className="text-right">Venta</th><th className="text-right">Margen</th><th className="text-right">%</th></tr></thead><tbody>
              {prodRows.map((p) => <tr key={p.name}><td>{p.name}</td><td className="num text-right">{num(p.qty)}</td><td className="num text-right">{money(p.revenue)}</td><td className="num text-right font-medium">{money(p.revenue - p.cost)}</td><td className="num text-right">{pct(p.revenue ? ((p.revenue - p.cost) / p.revenue) * 100 : 0)}</td></tr>)}
            </tbody></table>
          </Card>
          <Card title="Rentabilidad por venta (30 días)" bodyClassName="overflow-x-auto max-h-[640px]">
            <table className="table"><thead><tr><th>Pedido</th><th>Cliente</th><th className="text-right">Venta</th><th className="text-right">Margen</th></tr></thead><tbody>
              {orders30.slice(0, 40).map((o) => { const c = o.items.reduce((a, i) => a + i.unitCost * i.quantity, 0); return <tr key={o.id}><td><Link href={`/ventas/pedidos/${o.id}`} className="text-brand-600">{o.number}</Link></td><td>{o.customer.name}</td><td className="num text-right">{money(o.subtotal)}</td><td className="num text-right">{money(o.subtotal - c)} <span className="text-xs text-ink-500">({pct(o.subtotal ? ((o.subtotal - c) / o.subtotal) * 100 : 0, 0)})</span></td></tr>; })}
            </tbody></table>
          </Card>
        </div>
      )}
    </div>
  );
}
