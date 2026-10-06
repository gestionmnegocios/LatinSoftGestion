import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getProductOptions } from "@/server/queries";
import { PageHeader } from "@/components/ui";
import { QuoteEditor } from "../QuoteEditor";

export const metadata = { title: "Nueva cotización" };

export default async function NewQuote({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const s = await requireSession("ventas");
  const sp = await searchParams;
  const [customers, priceLists, products, counter] = await Promise.all([
    prisma.customer.findMany({ where: { organizationId: s.ctx.orgId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, documentNumber: true, priceListId: true } }),
    prisma.priceList.findMany({ where: { organizationId: s.ctx.orgId }, orderBy: { name: "asc" } }),
    getProductOptions(s.ctx.orgId, s.ctx.warehouseId),
    prisma.counter.findUnique({ where: { organizationId_key: { organizationId: s.ctx.orgId, key: "COT-2026" } } }),
  ]);
  const customer = customers.find((c) => c.id === sp.cliente);
  return (
    <div>
      <PageHeader title="Nueva cotización" subtitle="Cliente y productos" back={{ href: "/ventas/cotizaciones", label: "Cotizaciones" }} />
      <QuoteEditor
        customers={customers}
        priceLists={priceLists}
        products={products}
        warehouseId={s.ctx.warehouseId}
        warehouseName={s.warehouses.find((w) => w.id === s.ctx.warehouseId)?.name ?? ""}
        number={`COT-2026-${String((counter?.value ?? 0) + 1).padStart(5, "0")}`}
        salesperson={s.user.name}
        initial={customer ? { customerId: customer.id, priceListId: customer.priceListId, notes: null, validityDays: 15, items: [], status: "DRAFT" } : undefined}
      />
    </div>
  );
}
