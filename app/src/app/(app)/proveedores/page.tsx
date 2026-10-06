import Link from "next/link";
import { Plus, Star } from "lucide-react";
import { requireSession } from "@/server/auth";
import { prisma, ilike } from "@/server/db";
import { PageHeader, Empty } from "@/components/ui";
import { money } from "@/lib/format";

export const metadata = { title: "Proveedores" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { ctx } = await requireSession("proveedores");
  const { q } = await searchParams;
  const suppliers = await prisma.supplier.findMany({
    where: { organizationId: ctx.orgId, ...(q ? { OR: [{ legalName: ilike(q) }, { tradeName: ilike(q) }, { taxId: ilike(q) }] } : {}) },
    include: { _count: { select: { products: { where: { status: "ACTIVE" } }, purchaseOrders: true } } },
    orderBy: { legalName: "asc" },
  });
  const payables = await prisma.accountPayable.groupBy({ by: ["supplierId"], where: { organizationId: ctx.orgId, status: "PENDING" }, _sum: { amount: true, paidAmount: true } });
  const owed = new Map(payables.map((p) => [p.supplierId, (p._sum.amount ?? 0) - (p._sum.paidAmount ?? 0)]));
  return (
    <div>
      <PageHeader title="Proveedores" subtitle="Condiciones, catálogo por proveedor y cumplimiento" actions={<Link href="/proveedores/nuevo" className="btn-primary"><Plus size={15} /> Nuevo proveedor</Link>} />
      <form className="mb-4 max-w-sm"><input name="q" defaultValue={q} className="input" placeholder="Buscar por nombre o NIT…" /></form>
      <div className="card overflow-x-auto">
        {suppliers.length === 0 ? <Empty>No hay proveedores.</Empty> : (
          <table className="table min-w-[900px]">
            <thead><tr><th>Proveedor</th><th>NIT</th><th>Contacto</th><th>Pago</th><th className="text-right">Entrega</th><th className="text-right">Transporte</th><th>Cumplimiento</th><th className="text-right">Productos</th><th className="text-right">Por pagar</th></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/proveedores/${s.id}`} className="font-semibold text-brand-600">{s.tradeName ?? s.legalName}</Link><div className="text-xs text-ink-500">{s.legalName}</div></td>
                  <td>{s.taxId}</td>
                  <td>{s.contactName}<div className="text-xs text-ink-500">{s.phone}</div></td>
                  <td>{s.creditDays ? `Crédito ${s.creditDays} días` : s.paymentTerms}</td>
                  <td className="num text-right">{s.averageLeadTime} días</td>
                  <td className="num text-right">{s.shippingCost ? money(s.shippingCost) : "Incluido"}</td>
                  <td><span className="inline-flex items-center gap-1"><Star size={13} className="text-warning" fill="currentColor" /> {s.fulfillmentRating.toFixed(1)}</span></td>
                  <td className="num text-right">{s._count.products}</td>
                  <td className="num text-right font-medium">{money(owed.get(s.id) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
