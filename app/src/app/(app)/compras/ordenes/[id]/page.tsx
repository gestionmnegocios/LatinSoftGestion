import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Stat, Card } from "@/components/ui";
import { ActionButton, PrintButton } from "@/components/ActionButton";
import { DocHeader } from "@/components/DocHeader";
import { poTransitionAction } from "@/app/actions";
import { money, num, date, dateTime, PO_STATUS } from "@/lib/format";

export default async function PODetail({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("compras");
  const { id } = await params;
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: s.ctx.orgId },
    include: { supplier: true, items: { include: { product: true } }, receipts: { include: { items: true }, orderBy: { receivedAt: "asc" } }, requirement: true },
  });
  if (!po) notFound();
  const warehouse = await prisma.warehouse.findUnique({ where: { id: po.warehouseId } });
  const canApprove = can(s, "purchase.approve");
  const receivable = ["SENT", "CONFIRMED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(po.status);
  const sup = po.supplier.tradeName ?? po.supplier.legalName;

  return (
    <div>
      <PageHeader
        title={`Orden de compra ${po.number}`}
        subtitle={`${sup} · ${date(po.orderDate)}`}
        back={{ href: "/compras/ordenes", label: "Órdenes de compra" }}
        actions={
          <>
            <PrintButton>Descargar PDF</PrintButton>
            {["DRAFT", "SENT", "CONFIRMED", "IN_TRANSIT"].includes(po.status) && <ActionButton className="btn-ghost text-danger" confirm="¿Cancelar esta orden de compra?" action={poTransitionAction.bind(null, po.id, "CANCELLED")} success="OC cancelada.">Cancelar</ActionButton>}
            {po.status === "DRAFT" && canApprove && <ActionButton className="btn-primary" confirm={`¿Aprobar y enviar la OC a ${sup}${po.supplier.email ? ` (${po.supplier.email})` : ""}?`} action={poTransitionAction.bind(null, po.id, "SENT")} success="OC aprobada y enviada al proveedor.">Enviar al proveedor</ActionButton>}
            {po.status === "SENT" && canApprove && <ActionButton className="btn-primary" action={poTransitionAction.bind(null, po.id, "CONFIRMED")} success="Proveedor confirmó: mercancía en tránsito (incoming).">Proveedor confirmó</ActionButton>}
            {po.status === "CONFIRMED" && <ActionButton className="btn-outline" action={poTransitionAction.bind(null, po.id, "IN_TRANSIT")} success="OC en tránsito.">Marcar en tránsito</ActionButton>}
            {po.status === "PARTIALLY_RECEIVED" && <ActionButton className="btn-ghost" confirm="¿Cerrar la OC? Lo pendiente dejará de esperarse." action={poTransitionAction.bind(null, po.id, "CLOSED")} success="OC cerrada.">Cerrar OC</ActionButton>}
            {receivable && can(s, "inventory.receive") && <Link href={`/compras/recepciones/nueva?oc=${po.id}`} className="btn-success">Recibir mercancía</Link>}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="card p-6">
          <DocHeader orgId={s.ctx.orgId} title="Orden de compra" number={po.number} status={<StatusBadge map={PO_STATUS} value={po.status} />} />
          <div className="grid gap-4 py-4 text-[13px] sm:grid-cols-3">
            <div><div className="text-xs text-ink-500">Proveedor</div><div className="font-semibold">{po.supplier.legalName}</div><div className="text-ink-500">NIT {po.supplier.taxId}</div><div className="text-ink-500">{po.supplier.contactName} · {po.supplier.phone}</div></div>
            <div><div className="text-xs text-ink-500">Fecha / Entrega esperada</div><div>{date(po.orderDate)} → {date(po.expectedDate)}</div><div className="mt-1 text-xs text-ink-500">Condiciones</div><div>{po.paymentTerms}</div></div>
            <div><div className="text-xs text-ink-500">Bodega destino</div><div>{warehouse?.name}</div>{po.requirement && <><div className="mt-1 text-xs text-ink-500">Necesidad</div><Link href={`/compras/comparador/${po.requirement.id}`} className="text-brand-600">{po.requirement.number}</Link></>}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="table min-w-[640px]">
              <thead><tr><th>Producto</th><th className="text-right">Cantidad</th><th className="text-right">Recibido</th><th className="text-right">Pendiente</th><th className="text-right">Precio</th><th className="text-right">Desc.</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {po.items.map((i) => (
                  <tr key={i.id}>
                    <td><div className="font-medium">{i.product.name}</div><div className="font-mono text-[11px] text-ink-500">{i.product.sku}</div></td>
                    <td className="num text-right">{num(i.quantity)}</td>
                    <td className="num text-right">{num(i.receivedQuantity)}</td>
                    <td className={`num text-right ${i.quantity - i.receivedQuantity > 0 ? "font-semibold text-warning-ink" : "text-ink-500"}`}>{num(i.quantity - i.receivedQuantity)}</td>
                    <td className="num text-right">{money(i.unitCost)}</td>
                    <td className="num text-right">{i.discountPct ? `${i.discountPct}%` : "—"}</td>
                    <td className="num text-right font-medium">{money(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ml-auto mt-4 w-full max-w-xs">
            <Stat label="Subtotal" value={money(po.subtotal)} />
            {po.discount > 0 && <Stat label="Descuento" value={`-${money(po.discount)}`} />}
            <Stat label="IVA (19%)" value={money(po.tax)} />
            <Stat label="Transporte" value={money(po.shipping)} />
            <Stat label="Total" value={money(po.total)} strong />
          </div>
        </div>
        <Card title="Recepciones" className="h-fit no-print">
          {po.receipts.length === 0 ? <p className="text-[13px] text-ink-500">Aún no se ha recibido mercancía.</p> : (
            <ul className="space-y-3 text-[13px]">
              {po.receipts.map((r) => (
                <li key={r.id} className="border-l-2 border-success pl-3">
                  <div className="font-semibold">{r.number}</div>
                  <div className="text-xs text-ink-500">{dateTime(r.receivedAt)} · {r.receivedByName}</div>
                  <div className="text-xs">{r.items.reduce((s, i) => s + i.acceptedQuantity, 0)} unidades aceptadas{r.items.some((i) => i.rejectedQuantity) ? `, ${r.items.reduce((s, i) => s + i.rejectedQuantity, 0)} rechazadas` : ""}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export const metadata = { title: "Orden de compra" };
