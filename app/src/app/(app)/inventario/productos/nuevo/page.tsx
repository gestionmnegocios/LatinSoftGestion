import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { EntityForm } from "@/components/EntityForm";
import { saveProductAction } from "@/app/actions";
import { productFields, productSections } from "../fields";

export const metadata = { title: "Nuevo producto" };

export default async function NewProduct() {
  const { ctx } = await requireSession("inventario");
  const categories = await prisma.category.findMany({ where: { organizationId: ctx.orgId }, include: { parent: true }, orderBy: { name: "asc" } });
  return (
    <div className="max-w-4xl">
      <PageHeader title="Nuevo producto" subtitle="El inventario inicial se registra luego como ajuste (queda en el Kardex)" back={{ href: "/inventario/productos", label: "Productos" }} />
      <EntityForm
        fields={productFields(categories, true)}
        sections={productSections(true)}
        initial={{ unit: "UND", taxRate: 19, minimumStock: 0, safetyStock: 0, maximumStock: 0, averageCost: 0, salePrice: 0, status: "ACTIVE", categoryId: "" }}
        action={saveProductAction}
        redirectTo="/inventario/productos/{data}"
        cancelHref="/inventario/productos"
        submitLabel="Crear producto"
      />
    </div>
  );
}
