import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getProductOptions } from "@/server/queries";
import { PageHeader } from "@/components/ui";
import { QuoteEditor } from "../../QuoteEditor";

export const metadata = { title: "Editar cotización" };

export default async function EditQuote({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("ventas");
  const { id } = await params;
  const q = await prisma.quotation.findFirst({ where: { id, organizationId: s.ctx.orgId }, include: { items: true } });
  if (!q) notFound();
  if (!["DRAFT", "SENT"].includes(q.status)) redirect(`/ventas/cotizaciones/${id}`);
  const [customers, priceLists, products] = await Promise.all([
    prisma.customer.findMany({ where: { organizationId: s.ctx.orgId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, documentNumber: true, priceListId: true } }),
    prisma.priceList.findMany({ where: { organizationId: s.ctx.orgId }, orderBy: { name: "asc" } }),
    getProductOptions(s.ctx.orgId, q.warehouseId),
  ]);
  const validityDays = Math.max(1, Math.round((q.expirationDate.getTime() - q.issueDate.getTime()) / 86400000));
  return (
    <div>
      <PageHeader title={`Editar ${q.number}`} subtitle="Cliente y productos" back={{ href: `/ventas/cotizaciones/${id}`, label: q.number }} />
      <QuoteEditor
        customers={customers}
        priceLists={priceLists}
        products={products}
        warehouseId={q.warehouseId}
        warehouseName={s.warehouses.find((w) => w.id === q.warehouseId)?.name ?? ""}
        number={q.number}
        salesperson={q.salespersonName ?? s.user.name}
        initial={{ id: q.id, customerId: q.customerId, priceListId: q.priceListId, notes: q.notes, validityDays, status: q.status, items: q.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, discountPct: i.discountPct })) }}
      />
    </div>
  );
}
