import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Stat, Card } from "@/components/ui";
import { PrintButton } from "@/components/ActionButton";
import { DocHeader } from "@/components/DocHeader";
import { PaymentForm } from "./PaymentForm";
import { money, num, date, dateTime, INVOICE_STATUS } from "@/lib/format";

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("ventas");
  const { id } = await params;
  const inv = await prisma.invoice.findFirst({
    where: { id, organizationId: s.ctx.orgId },
    include: { customer: true, payments: { orderBy: { createdAt: "asc" } }, salesOrder: { include: { items: { include: { product: true } } } } },
  });
  if (!inv) notFound();
  const balance = inv.total - inv.paidAmount;
  const late = inv.status !== "PAID" && inv.dueDate < new Date();
  return (
    <div>
      <PageHeader title={inv.number} subtitle={inv.customer.name} back={{ href: "/ventas/facturas", label: "Facturas" }} actions={<><Link href={`/ventas/pedidos/${inv.salesOrderId}`} className="btn-ghost">Pedido {inv.salesOrder.number}</Link><PrintButton /></>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="card p-6">
          <DocHeader orgId={s.ctx.orgId} title="Factura de venta" number={inv.number} status={<StatusBadge map={INVOICE_STATUS} value={late ? "OVERDUE" : inv.status} />} />
          <div className="grid gap-4 py-4 text-[13px] sm:grid-cols-3">
            <div><div className="text-xs text-ink-500">Cliente</div><div className="font-semibold">{inv.customer.name}</div><div className="text-ink-500">{inv.customer.documentType} {inv.customer.documentNumber}</div></div>
            <div><div className="text-xs text-ink-500">Emisión</div><div>{date(inv.issueDate)}</div></div>
            <div><div className="text-xs text-ink-500">Vencimiento</div><div className={late ? "font-semibold text-danger" : ""}>{date(inv.dueDate)} {inv.customer.creditDays ? `(${inv.customer.creditDays} días)` : "(contado)"}</div></div>
          </div>
          <div className="overflow-x-auto">
            <table className="table min-w-[560px]">
              <thead><tr><th>Producto</th><th className="text-right">Cant.</th><th className="text-right">Precio</th><th className="text-right">IVA</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {inv.salesOrder.items.map((i) => (
                  <tr key={i.id}><td>{i.product.name}</td><td className="num text-right">{num(i.fulfilledQuantity || i.quantity)}</td><td className="num text-right">{money(i.unitPrice)}</td><td className="num text-right">{i.taxRate}%</td><td className="num text-right">{money(i.total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ml-auto mt-4 w-full max-w-xs">
            <Stat label="Subtotal" value={money(inv.subtotal)} />
            <Stat label="IVA" value={money(inv.tax)} />
            <Stat label="Total" value={money(inv.total)} strong />
            <Stat label="Pagado" value={money(inv.paidAmount)} />
            <Stat label="Saldo" value={money(balance)} strong />
          </div>
        </div>
        <div className="space-y-4 no-print">
          {balance > 0.5 && can(s, "finance.receive_payment") && (
            <Card title="Registrar pago"><PaymentForm invoiceId={inv.id} balance={balance} /></Card>
          )}
          <Card title="Pagos">
            {inv.payments.length === 0 ? <p className="text-[13px] text-ink-500">Sin pagos registrados.</p> : (
              <ul className="space-y-2 text-[13px]">
                {inv.payments.map((p) => <li key={p.id} className="flex justify-between"><span>{dateTime(p.createdAt)} · {p.method}</span><b className="num">{money(p.amount)}</b></li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export const metadata = { title: "Factura" };
