import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Card } from "@/components/ui";
import { ReceiptForm } from "./ReceiptForm";
import { date, PO_STATUS } from "@/lib/format";
import { Truck } from "lucide-react";

export const metadata = { title: "Recepción de mercancía" };

export default async function NewReceipt({ searchParams }: { searchParams: Promise<{ oc?: string; q?: string }> }) {
  const { ctx } = await requireSession("compras");
  const sp = await searchParams;
  if (!sp.oc && sp.q) {
    const found = await prisma.purchaseOrder.findFirst({ where: { organizationId: ctx.orgId, number: { contains: sp.q.trim().toUpperCase() } } });
    if (found) redirect(`/compras/recepciones/nueva?oc=${found.id}`);
  }
  const po = sp.oc ? await prisma.purchaseOrder.findFirst({ where: { id: sp.oc, organizationId: ctx.orgId }, include: { supplier: true, items: { include: { product: true } } } }) : null;
  return (
    <div>
      <PageHeader title="Recepción de mercancía" back={{ href: "/compras/recepciones", label: "Recepciones" }}
        actions={<form className="flex gap-2"><input name="q" defaultValue={po?.number ?? sp.q} className="input w-48" placeholder="OC-2026-00158" /><button className="btn-primary">Buscar</button></form>} />
      {!po ? (
        <Card><p className="text-ink-500">{sp.q ? `No se encontró la OC "${sp.q}".` : "Busque una orden de compra o elija una desde "}<Link href="/compras/recepciones" className="text-brand-600">Órdenes por recibir</Link>.</p></Card>
      ) : (
        <>
          <div className="card mb-4 flex flex-wrap items-center gap-6 p-4 text-[13px]">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600"><Truck size={20} /></div>
            <div><div className="text-xs text-ink-500">Proveedor</div><div className="font-semibold">{po.supplier.tradeName ?? po.supplier.legalName}</div></div>
            <div><div className="text-xs text-ink-500">Orden</div><Link href={`/compras/ordenes/${po.id}`} className="font-semibold text-brand-600">{po.number}</Link></div>
            <div><div className="text-xs text-ink-500">Fecha OC</div><div>{date(po.orderDate)}</div></div>
            <div><div className="text-xs text-ink-500">Entrega esperada</div><div>{date(po.expectedDate)}</div></div>
            <div><div className="text-xs text-ink-500">Estado OC</div><StatusBadge map={PO_STATUS} value={po.status} /></div>
          </div>
          {["SENT", "CONFIRMED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(po.status) ? (
            <ReceiptForm
              poId={po.id}
              items={po.items.map((i) => ({ id: i.id, productId: i.productId, name: i.product.name, sku: i.product.sku, barcode: i.product.barcode, ordered: i.quantity, received: i.receivedQuantity, unitCost: i.unitCost, trackLot: i.product.trackLot, trackExpiration: i.product.trackExpiration }))}
            />
          ) : <Card><p className="text-ink-500">Esta OC está en estado “{PO_STATUS[po.status]?.label}” y no admite recepciones.</p></Card>}
        </>
      )}
    </div>
  );
}
