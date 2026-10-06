import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { compareSuppliers, SCORE_WEIGHTS } from "@/server/services/procurement";
import { PageHeader } from "@/components/ui";
import { Comparator } from "./Comparator";

export const metadata = { title: "Comparación de proveedores" };

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession("compras");
  const { id } = await params;
  const req = await prisma.purchaseRequirement.findFirst({ where: { id, organizationId: ctx.orgId }, include: { purchaseOrders: true } });
  if (!req) notFound();
  const cmp = await compareSuppliers(ctx.orgId, id);
  return (
    <div>
      <PageHeader
        title="Comparación de proveedores"
        subtitle={`${req.number} · Selecciona la mejor opción de compra`}
        back={{ href: "/compras/necesidades", label: "Necesidades" }}
      />
      {req.status !== "OPEN" && (
        <div className="mb-4 rounded-xl border border-success/25 bg-success-bg p-3 text-[13px] text-success">
          Esta necesidad ya generó órdenes de compra: {req.purchaseOrders.map((p) => <Link key={p.id} href={`/compras/ordenes/${p.id}`} className="mr-2 font-semibold underline">{p.number}</Link>)}
        </div>
      )}
      <Comparator cmp={cmp} open={req.status === "OPEN"} weights={SCORE_WEIGHTS} />
    </div>
  );
}
