import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getProductOptions } from "@/server/queries";
import { PageHeader } from "@/components/ui";
import { POForm } from "./POForm";

export const metadata = { title: "Nueva orden de compra" };

export default async function NewPO() {
  const s = await requireSession("compras");
  const [suppliers, products, offers] = await Promise.all([
    prisma.supplier.findMany({ where: { organizationId: s.ctx.orgId, status: "ACTIVE" }, orderBy: { legalName: "asc" } }),
    getProductOptions(s.ctx.orgId, s.ctx.warehouseId),
    prisma.supplierProduct.findMany({ where: { organizationId: s.ctx.orgId, status: "ACTIVE" } }),
  ]);
  return (
    <div>
      <PageHeader title="Nueva orden de compra" subtitle="Compra manual (para compras sugeridas use Necesidades → Comparador)" back={{ href: "/compras/ordenes", label: "Órdenes de compra" }} />
      <POForm
        suppliers={suppliers.map((x) => ({ id: x.id, name: x.tradeName ?? x.legalName, shipping: x.shippingCost }))}
        products={products}
        offers={offers.map((o) => ({ supplierId: o.supplierId, productId: o.productId, price: o.price }))}
        warehouseId={s.ctx.warehouseId}
      />
    </div>
  );
}
