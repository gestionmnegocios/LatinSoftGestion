import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { EntityForm } from "@/components/EntityForm";
import { saveCustomerAction } from "@/app/actions";
import { customerFields, customerSections } from "../fields";

export const metadata = { title: "Nuevo cliente" };

export default async function NewCustomer() {
  const { ctx } = await requireSession("ventas");
  const lists = await prisma.priceList.findMany({ where: { organizationId: ctx.orgId } });
  return (
    <div className="max-w-4xl">
      <PageHeader title="Nuevo cliente" back={{ href: "/ventas/clientes", label: "Clientes" }} />
      <EntityForm
        fields={customerFields(lists)}
        sections={customerSections}
        initial={{ documentType: "NIT", priceListId: lists.find((l) => l.isDefault)?.id ?? "", creditLimit: 0, creditDays: 0 }}
        action={saveCustomerAction}
        redirectTo="/ventas/clientes/{data}"
        cancelHref="/ventas/clientes"
        submitLabel="Crear cliente"
      />
    </div>
  );
}
