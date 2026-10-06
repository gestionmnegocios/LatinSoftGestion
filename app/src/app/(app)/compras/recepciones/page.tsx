import Link from "next/link";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, Card, StatusBadge, Empty } from "@/components/ui";
import { money, date, dateTime, PO_STATUS } from "@/lib/format";

export const metadata = { title: "Recepciones" };

export default async function ReceiptsPage() {
  const { ctx } = await requireSession("compras");
  const [pending, receipts] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { organizationId: ctx.orgId, status: { in: ["SENT", "CONFIRMED", "IN_TRANSIT", "PARTIALLY_RECEIVED"] } }, include: { supplier: true }, orderBy: { expectedDate: "asc" } }),
    prisma.goodsReceipt.findMany({ where: { organizationId: ctx.orgId }, include: { purchaseOrder: { include: { supplier: true } }, items: true }, orderBy: { receivedAt: "desc" }, take: 25 }),
  ]);
  return (
    <div>
      <PageHeader title="Recepción de mercancía" subtitle="Recepción total o parcial · actualiza Kardex, inventario, costo promedio, OC y cuentas por pagar" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Órdenes por recibir" bodyClassName="overflow-x-auto">
          {pending.length === 0 ? <Empty>No hay órdenes pendientes de recibir.</Empty> : (
            <table className="table">
              <thead><tr><th>OC</th><th>Proveedor</th><th>Esperada</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/compras/ordenes/${p.id}`} className="font-semibold text-brand-600">{p.number}</Link></td>
                    <td>{p.supplier.tradeName ?? p.supplier.legalName}</td>
                    <td>{date(p.expectedDate)}</td>
                    <td><StatusBadge map={PO_STATUS} value={p.status} /></td>
                    <td><Link href={`/compras/recepciones/nueva?oc=${p.id}`} className="btn-success px-2.5 py-1 text-xs">Recibir</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Recepciones registradas" bodyClassName="overflow-x-auto">
          {receipts.length === 0 ? <Empty>Sin recepciones.</Empty> : (
            <table className="table">
              <thead><tr><th>Recepción</th><th>OC / Proveedor</th><th>Fecha</th><th className="text-right">Unidades</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.number}</td>
                    <td><Link href={`/compras/ordenes/${r.purchaseOrderId}`} className="text-brand-600">{r.purchaseOrder.number}</Link><div className="text-xs text-ink-500">{r.purchaseOrder.supplier.tradeName ?? r.purchaseOrder.supplier.legalName}</div></td>
                    <td className="whitespace-nowrap">{dateTime(r.receivedAt)}</td>
                    <td className="num text-right">{r.items.reduce((s, i) => s + i.acceptedQuantity, 0)}</td>
                    <td className="num text-right">{money(r.items.reduce((s, i) => s + i.acceptedQuantity * i.unitCost, 0))}</td>
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
