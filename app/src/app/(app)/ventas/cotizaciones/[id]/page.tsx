import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Badge, Stat } from "@/components/ui";
import { ActionButton, PrintButton } from "@/components/ActionButton";
import { DocHeader } from "@/components/DocHeader";
import { convertQuoteAction, duplicateQuoteAction, quoteStatusAction } from "@/app/actions";
import { money, num, date, QUOTE_STATUS } from "@/lib/format";

export default async function QuoteDetail({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession("ventas");
  const { id } = await params;
  const q = await prisma.quotation.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { customer: true, items: { include: { product: { include: { balances: true } } } }, salesOrder: true },
  });
  if (!q) notFound();
  const editable = ["DRAFT", "SENT"].includes(q.status);
  const lines = q.items.map((i) => {
    const b = i.product.balances.find((x) => x.warehouseId === q.warehouseId);
    const availableNow = (b?.onHand ?? 0) - (b?.reserved ?? 0);
    return { ...i, availableNow, missing: Math.max(0, i.quantity - Math.max(0, availableNow)) };
  });
  const shortages = lines.filter((l) => l.missing > 0);
  const warehouse = await prisma.warehouse.findUnique({ where: { id: q.warehouseId } });

  return (
    <div>
      <PageHeader
        title={q.number}
        subtitle={`${q.customer.name} · ${date(q.issueDate)}`}
        back={{ href: "/ventas/cotizaciones", label: "Cotizaciones" }}
        actions={
          <>
            {editable && <Link href={`/ventas/cotizaciones/${q.id}/editar`} className="btn-ghost">Editar</Link>}
            <ActionButton className="btn-ghost" action={duplicateQuoteAction.bind(null, q.id)} redirectTo="/ventas/cotizaciones/{data}" success="Cotización duplicada">Duplicar</ActionButton>
            <PrintButton />
            {editable && q.status === "DRAFT" && <ActionButton className="btn-primary" action={quoteStatusAction.bind(null, q.id, "SENT")} success="Cotización marcada como enviada">Enviar cotización</ActionButton>}
            {editable && <ActionButton className="btn-ghost text-danger" confirm="¿Marcar la cotización como rechazada?" action={quoteStatusAction.bind(null, q.id, "REJECTED")}>Rechazar</ActionButton>}
            {editable && (
              <ActionButton
                className="btn-success"
                confirm={shortages.length ? `Hay faltantes (${shortages.map((s) => `${s.product.name}: ${s.missing}`).join(", ")}). Se reservará lo disponible y el resto quedará pendiente. ¿Continuar?` : undefined}
                action={convertQuoteAction.bind(null, q.id)}
                redirectTo="/ventas/pedidos/{data.orderId}"
                success="Pedido creado; el inventario disponible quedó reservado."
              >
                Convertir en pedido
              </ActionButton>
            )}
            {q.salesOrder && <Link href={`/ventas/pedidos/${q.salesOrder.id}`} className="btn-primary">Ver pedido {q.salesOrder.number}</Link>}
          </>
        }
      />

      {editable && shortages.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-bg p-4 text-[13px] no-print">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
          <div><b className="text-danger">Faltantes con la disponibilidad actual:</b> {shortages.map((s) => `${s.product.name} (faltan ${num(s.missing)})`).join(", ")}.</div>
        </div>
      )}

      <div className="card p-6">
        <DocHeader orgId={ctx.orgId} title="Cotización" number={q.number} status={<StatusBadge map={QUOTE_STATUS} value={q.status} />} />
        <div className="grid gap-4 py-4 text-[13px] sm:grid-cols-3">
          <div><div className="text-xs text-ink-500">Cliente</div><div className="font-semibold">{q.customer.name}</div><div className="text-ink-500">{q.customer.documentType} {q.customer.documentNumber}</div><div className="text-ink-500">{q.customer.contactName} · {q.customer.phone}</div></div>
          <div><div className="text-xs text-ink-500">Fecha / Validez</div><div>{date(q.issueDate)} — vence {date(q.expirationDate)}</div><div className="mt-1 text-xs text-ink-500">Vendedor</div><div>{q.salespersonName ?? "—"}</div></div>
          <div><div className="text-xs text-ink-500">Bodega</div><div>{warehouse?.name}</div>{q.notes && <><div className="mt-1 text-xs text-ink-500">Observaciones</div><div>{q.notes}</div></>}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="table min-w-[720px]">
            <thead><tr><th>#</th><th>SKU</th><th>Producto</th><th className="text-right">Cant.</th><th className="text-right">Precio</th><th className="text-right">Desc.</th><th className="text-right">IVA</th><th className="text-right">Subtotal</th><th className="no-print">Disponibilidad</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id}>
                  <td>{i + 1}</td>
                  <td className="font-mono text-xs">{l.product.sku}</td>
                  <td>{l.product.name}</td>
                  <td className="num text-right">{num(l.quantity)}</td>
                  <td className="num text-right">{money(l.unitPrice)}</td>
                  <td className="num text-right">{l.discountPct ? `${l.discountPct}%` : "—"}</td>
                  <td className="num text-right">{l.taxRate}%</td>
                  <td className="num text-right font-medium">{money(l.subtotal)}</td>
                  <td className="no-print">
                    {!editable ? <span className="text-xs text-ink-500">Al cotizar: {num(l.availableStockSnapshot)}</span>
                      : l.missing > 0 ? <Badge tone={l.availableNow <= 0 ? "danger" : "warning"}>Faltan {num(l.missing)}</Badge>
                      : <Badge tone="success">Disponible ({num(l.availableNow)})</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ml-auto mt-4 w-full max-w-xs">
          <Stat label="Subtotal" value={money(q.subtotal + q.discount)} />
          {q.discount > 0 && <Stat label="Descuento" value={`-${money(q.discount)}`} />}
          <Stat label="IVA" value={money(q.tax)} />
          <Stat label="Total" value={money(q.total)} strong />
        </div>
      </div>
    </div>
  );
}

export const metadata = { title: "Cotización" };
