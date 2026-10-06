import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Stat, Card } from "@/components/ui";
import { ActionButton, PrintButton } from "@/components/ActionButton";
import { DocHeader } from "@/components/DocHeader";
import { orderAction } from "@/app/actions";
import { money, num, date, dateTime, ORDER_STATUS } from "@/lib/format";

const FLOW = ["CONFIRMED", "PREPARING", "READY", "DISPATCHED", "DELIVERED"];

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession("ventas");
  const { id } = await params;
  const o = await prisma.salesOrder.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { customer: true, quotation: true, invoice: true, items: { include: { product: { include: { balances: true } } } } },
  });
  if (!o) notFound();
  const [history, warehouse] = await Promise.all([
    prisma.auditLog.findMany({ where: { organizationId: ctx.orgId, entityId: o.id }, orderBy: { createdAt: "asc" } }),
    prisma.warehouse.findUnique({ where: { id: o.warehouseId } }),
  ]);
  const open = ["CONFIRMED", "PREPARING", "READY", "PARTIAL"].includes(o.status);
  const lines = o.items.map((i) => {
    const pending = Math.max(0, i.quantity - i.reservedQuantity - i.fulfilledQuantity);
    const b = i.product.balances.find((x) => x.warehouseId === o.warehouseId);
    return { ...i, pending, incoming: b?.incoming ?? 0 };
  });
  const shortage = lines.filter((l) => l.pending > 0);
  const reservedTotal = lines.reduce((s, l) => s + l.reservedQuantity, 0);
  const stepIndex = FLOW.indexOf(o.status === "PARTIAL" ? "READY" : o.status);

  return (
    <div>
      <PageHeader
        title={o.number}
        subtitle={`${o.customer.name} · ${date(o.createdAt)}${o.quotation ? ` · desde ${o.quotation.number}` : ""}`}
        back={{ href: "/ventas/pedidos", label: "Pedidos" }}
        actions={
          <>
            <PrintButton />
            {open && <ActionButton className="btn-ghost text-danger" confirm="¿Cancelar el pedido? Se liberarán las reservas." action={orderAction.bind(null, o.id, "cancel")} success="Pedido cancelado, reservas liberadas.">Cancelar</ActionButton>}
            {["CONFIRMED", "READY", "PARTIAL"].includes(o.status) && <ActionButton className="btn-outline" action={orderAction.bind(null, o.id, "prepare")} success="Pedido en preparación.">Preparar</ActionButton>}
            {open && (
              <ActionButton
                className="btn-success"
                disabled={reservedTotal === 0}
                confirm={shortage.length ? "Hay faltantes: se despachará solo lo reservado y el pedido quedará parcial. ¿Continuar?" : "¿Confirmar despacho? Se descontará el inventario físico."}
                action={orderAction.bind(null, o.id, "dispatch")}
                success="Despacho registrado en el Kardex."
              >
                {shortage.length ? "Despachar parcial" : "Despachar"}
              </ActionButton>
            )}
            {o.status === "DISPATCHED" && <ActionButton className="btn-outline" action={orderAction.bind(null, o.id, "deliver")} success="Pedido entregado.">Marcar entregado</ActionButton>}
            {["DISPATCHED", "DELIVERED"].includes(o.status) && !o.invoice && <ActionButton className="btn-primary" action={orderAction.bind(null, o.id, "invoice")} redirectTo="/ventas/facturas/{data}" success="Factura generada.">Facturar</ActionButton>}
            {o.invoice && <Link href={`/ventas/facturas/${o.invoice.id}`} className="btn-primary">Ver factura {o.invoice.number}</Link>}
          </>
        }
      />

      {o.status !== "CANCELLED" && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 p-4 text-[13px] no-print">
          {FLOW.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i <= stepIndex ? "bg-brand-600 text-white" : "bg-surface-100 text-ink-500"}`}>{i + 1}</span>
              <span className={i <= stepIndex ? "font-semibold" : "text-ink-500"}>{ORDER_STATUS[s].label}{s === "READY" && o.status === "PARTIAL" ? " (parcial)" : ""}</span>
              {i < FLOW.length - 1 && <span className="mx-1 hidden h-px w-8 bg-line-300 sm:block" />}
            </div>
          ))}
        </div>
      )}

      {open && shortage.length > 0 && (
        <div className="mb-4 rounded-xl border border-danger/25 bg-danger-bg p-4 text-[13px] no-print">
          <div className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle size={18} /> Pedido pendiente por faltante</div>
          <ul className="mt-2 space-y-1 text-ink-700">
            {shortage.map((l) => <li key={l.id}>• {l.product.name}: faltan {num(l.pending)} {l.incoming > 0 && <span className="text-ink-500">({num(l.incoming)} en tránsito por OC)</span>}</li>)}
          </ul>
          <p className="mt-2 text-ink-500">Cuando se reciba la mercancía, el sistema reservará automáticamente para este pedido y te notificará.</p>
          <Link href="/compras/necesidades?tab=pedidos" className="btn-danger mt-3">Generar necesidad de compra</Link>
        </div>
      )}
      {open && shortage.length === 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-success/25 bg-success-bg p-3 text-[13px] text-success no-print">
          <CheckCircle2 size={18} /> Todo el inventario del pedido está reservado. Listo para despachar.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="card p-6">
          <DocHeader orgId={ctx.orgId} title="Pedido de venta" number={o.number} status={<StatusBadge map={ORDER_STATUS} value={o.status} />} />
          <div className="grid gap-4 py-4 text-[13px] sm:grid-cols-3">
            <div><div className="text-xs text-ink-500">Cliente</div><div className="font-semibold">{o.customer.name}</div><div className="text-ink-500">{o.customer.documentType} {o.customer.documentNumber}</div><div className="text-ink-500">{o.customer.address} · {o.customer.city}</div></div>
            <div><div className="text-xs text-ink-500">Confirmado</div><div>{dateTime(o.confirmedAt)}</div>{o.dispatchedAt && <><div className="mt-1 text-xs text-ink-500">Despachado</div><div>{dateTime(o.dispatchedAt)}</div></>}</div>
            <div><div className="text-xs text-ink-500">Bodega</div><div>{warehouse?.name}</div>{o.notes && <><div className="mt-1 text-xs text-ink-500">Observaciones</div><div>{o.notes}</div></>}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="table min-w-[720px]">
              <thead><tr><th>Producto</th><th className="text-right">Pedido</th><th className="text-right">Reservado</th><th className="text-right">Despachado</th><th className="text-right">Pendiente</th><th className="text-right">Precio</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td><div className="font-medium">{l.product.name}</div><div className="font-mono text-[11px] text-ink-500">{l.product.sku}</div></td>
                    <td className="num text-right">{num(l.quantity)}</td>
                    <td className="num text-right">{num(l.reservedQuantity)}</td>
                    <td className="num text-right">{num(l.fulfilledQuantity)}</td>
                    <td className={`num text-right font-semibold ${l.pending > 0 ? "text-danger" : "text-ink-500"}`}>{num(l.pending)}</td>
                    <td className="num text-right">{money(l.unitPrice)}</td>
                    <td className="num text-right font-medium">{money(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ml-auto mt-4 w-full max-w-xs">
            <Stat label="Subtotal" value={money(o.subtotal)} />
            <Stat label="IVA" value={money(o.tax)} />
            <Stat label="Total" value={money(o.total)} strong />
          </div>
        </div>
        <Card title="Historial" className="no-print h-fit">
          <ol className="space-y-3 text-[13px]">
            {history.length === 0 && <li className="text-ink-500">Sin eventos registrados.</li>}
            {history.map((h) => (
              <li key={h.id} className="border-l-2 border-brand-500 pl-3">
                <div className="font-medium">{h.action.replace("sales_order.", "").replace("create", "Creado").replace("dispatch", "Despacho").replace("prepare", "Preparación").replace("cancel", "Cancelación").replace("deliver", "Entrega")}</div>
                <div className="text-xs text-ink-500">{dateTime(h.createdAt)} · {h.userName}</div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

export const metadata = { title: "Pedido" };
