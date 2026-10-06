import { requireSession } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { EntityForm } from "@/components/EntityForm";
import { saveSupplierAction } from "@/app/actions";
import { supplierFields, supplierSections } from "../fields";

export const metadata = { title: "Nuevo proveedor" };

export default async function NewSupplier() {
  await requireSession("proveedores");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Nuevo proveedor" back={{ href: "/proveedores", label: "Proveedores" }} />
      <EntityForm
        fields={supplierFields}
        sections={supplierSections}
        initial={{ paymentTerms: "Contado", creditDays: 0, averageLeadTime: 3, shippingCost: 0, fulfillmentRating: 4 }}
        action={saveSupplierAction}
        redirectTo="/proveedores/{data}"
        cancelHref="/proveedores"
        submitLabel="Crear proveedor"
      />
    </div>
  );
}
