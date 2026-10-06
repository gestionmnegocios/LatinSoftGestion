import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, Card, StatusBadge, KpiCard, Badge } from "@/components/ui";
import { EntityForm } from "@/components/EntityForm";
import { saveCustomerAction } from "@/app/actions";
import { customerFields, customerSections } from "../fields";
import { money, num, date, QUOTE_STATUS, ORDER_STATUS, INVOICE_STATUS } from "@/lib/format";
import { Wallet, ShoppingCart, FileText, CreditCard } from "lucide-react";

export default async function CustomerDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { ctx } = await requireSession("ventas");
  const { id } = await params;
  const { tab = "historial" } = await searchParams;
  const c = await prisma.customer.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      quotations: { orderBy: { createdAt: "desc" }, take: 10 },
      salesOrders: { orderBy: { createdAt: "desc" }, take: 10 },
      invoices: { orderBy: { issueDate: "desc" }, include: { payments: true } },
    },
  });
  if (!c) notFound();
  const lists = await prisma.priceList.findMany({ where: { organizationId: ctx.orgId } });
  const products = await prisma.salesOrderItem.groupBy({
    by: ["productId"],
    where: { salesOrder: { customerId: c.id, status: { not: "CANCELLED" } } },
    _sum: { quantity: true, subtotal: true },
    orderBy: { _sum: { subtotal: "desc" } },
    take: 8,
  });
  const productNames = new Map((await prisma.product.findMany({ where: { id: { in: products.map((p) => p.productId) } } })).map((p) => [p.id, p.name]));
  const open = c.invoices.filter((i) => i.status !== "PAID");
  const balance = open.reduce((s, i) => s + i.total - i.paidAmount, 0);
  const payments = c.invoices.flatMap((i) => i.payments.map((p) => ({ ...p, invoice: i.number }))).sort((a, b) => +b.createdAt - +a.createdAt).slice(0, 10);
  const totalBought = c.invoices.reduce((s, i) => s + i.total, 0);

  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={`${c.documentType} ${c.documentNumber} · ${c.city ?? ""}`}
        back={{ href: "/ventas/clientes", label: "Clientes" }}
        actions={<Link href={`/ventas/cotizaciones/nueva?cliente=${c.id}`} className="btn-primary">Nueva cotización</Link>}
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Saldo por cobrar" value={money(balance)} icon={Wallet} tone={balance > c.creditLimit && c.creditLimit > 0 ? "red" : "blue"} hint={c.creditLimit ? `Cupo ${money(c.creditLimit)}` : "Contado"} />
        <KpiCard label="Cupo disponible" value={c.creditLimit ? money(Math.max(0, c.creditLimit - balance)) : "—"} icon={CreditCard} tone="green" hint={`Plazo ${c.creditDays} días`} />
        <KpiCard label="Compras históricas" value={money(totalBought)} icon={ShoppingCart} tone="green" hint={`${c.invoices.length} facturas`} />
        <KpiCard label="Cotizaciones recientes" value={num(c.quotations.length)} icon={FileText} tone="purple" />
      </div>
      <div className="mb-4 flex gap-2">
        {[["historial", "Historial"], ["datos", "Datos del cliente"]].map(([k, l]) => (
          <Link key={k} href={`?tab=${k}`} className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium ${tab === k ? "border-brand-500 bg-brand-100 text-brand-600" : "border-line-200 bg-white"}`}>{l}</Link>
        ))}
      </div>
      {tab === "datos" ? (
        <div className="max-w-4xl">
          <EntityForm fields={customerFields(lists)} sections={customerSections} initial={{ id: c.id, ...Object.fromEntries(customerFields(lists).map((f) => [f.name, (c as Record<string, unknown>)[f.name] ?? ""])) }} action={saveCustomerAction} />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Pedidos" bodyClassName="overflow-x-auto">
            <table className="table"><thead><tr><th>Pedido</th><th>Fecha</th><th className="text-right">Total</th><th>Estado</th></tr></thead><tbody>
              {c.salesOrders.map((o) => <tr key={o.id}><td><Link className="text-brand-600" href={`/ventas/pedidos/${o.id}`}>{o.number}</Link></td><td>{date(o.createdAt)}</td><td className="num text-right">{money(o.total)}</td><td><StatusBadge map={ORDER_STATUS} value={o.status} /></td></tr>)}
            </tbody></table>
          </Card>
          <Card title="Cotizaciones" bodyClassName="overflow-x-auto">
            <table className="table"><thead><tr><th>Cotización</th><th>Fecha</th><th className="text-right">Total</th><th>Estado</th></tr></thead><tbody>
              {c.quotations.map((q) => <tr key={q.id}><td><Link className="text-brand-600" href={`/ventas/cotizaciones/${q.id}`}>{q.number}</Link></td><td>{date(q.issueDate)}</td><td className="num text-right">{money(q.total)}</td><td><StatusBadge map={QUOTE_STATUS} value={q.status} /></td></tr>)}
            </tbody></table>
          </Card>
          <Card title="Facturas abiertas" bodyClassName="overflow-x-auto">
            {open.length === 0 ? <p className="p-4 text-[13px] text-ink-500">Sin saldo pendiente.</p> : (
              <table className="table"><thead><tr><th>Factura</th><th>Vence</th><th className="text-right">Saldo</th><th>Estado</th></tr></thead><tbody>
                {open.slice(0, 10).map((i) => <tr key={i.id}><td><Link className="text-brand-600" href={`/ventas/facturas/${i.id}`}>{i.number}</Link></td><td>{date(i.dueDate)}</td><td className="num text-right">{money(i.total - i.paidAmount)}</td><td><StatusBadge map={INVOICE_STATUS} value={i.dueDate < new Date() ? "OVERDUE" : i.status} /></td></tr>)}
              </tbody></table>
            )}
          </Card>
          <Card title="Pagos recientes" bodyClassName="overflow-x-auto">
            <table className="table"><thead><tr><th>Fecha</th><th>Factura</th><th>Medio</th><th className="text-right">Valor</th></tr></thead><tbody>
              {payments.map((p) => <tr key={p.id}><td>{date(p.createdAt)}</td><td>{p.invoice}</td><td>{p.method}</td><td className="num text-right">{money(p.amount)}</td></tr>)}
            </tbody></table>
          </Card>
          <Card title="Productos comprados" className="xl:col-span-2" bodyClassName="overflow-x-auto">
            <table className="table"><thead><tr><th>Producto</th><th className="text-right">Unidades</th><th className="text-right">Valor (antes de IVA)</th></tr></thead><tbody>
              {products.map((p) => <tr key={p.productId}><td><Link className="hover:text-brand-600" href={`/inventario/productos/${p.productId}`}>{productNames.get(p.productId)}</Link></td><td className="num text-right">{num(p._sum.quantity)}</td><td className="num text-right">{money(p._sum.subtotal)}</td></tr>)}
            </tbody></table>
          </Card>
        </div>
      )}
      {c.creditLimit > 0 && balance > c.creditLimit && <div className="mt-4"><Badge tone="danger">Cliente excede su cupo de crédito en {money(balance - c.creditLimit)}</Badge></div>}
    </div>
  );
}

export const metadata = { title: "Cliente" };
