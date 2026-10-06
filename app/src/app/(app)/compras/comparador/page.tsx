import Link from "next/link";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, Empty, Badge } from "@/components/ui";
import { date } from "@/lib/format";

export const metadata = { title: "Comparador de proveedores" };

export default async function ComparatorIndex() {
  const { ctx } = await requireSession("compras");
  const reqs = await prisma.purchaseRequirement.findMany({
    where: { organizationId: ctx.orgId },
    include: { items: { include: { product: true } }, purchaseOrders: { select: { number: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return (
    <div>
      <PageHeader title="Comparador de proveedores" subtitle="Seleccione una necesidad de compra para comparar alternativas" actions={<Link href="/compras/necesidades" className="btn-primary">Nueva necesidad</Link>} />
      <div className="card overflow-x-auto">
        {reqs.length === 0 ? <Empty>No hay necesidades de compra. Genérelas desde <Link href="/compras/necesidades" className="text-brand-600">Necesidades</Link>.</Empty> : (
          <table className="table">
            <thead><tr><th>Necesidad</th><th>Fecha</th><th>Productos</th><th>Estado</th></tr></thead>
            <tbody>
              {reqs.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/compras/comparador/${r.id}`} className="font-semibold text-brand-600">{r.number}</Link></td>
                  <td>{date(r.createdAt)}</td>
                  <td className="text-xs">{r.items.slice(0, 4).map((i) => `${i.approvedQuantity} ${i.product.name}`).join(", ")}{r.items.length > 4 ? ` y ${r.items.length - 4} más` : ""}</td>
                  <td>{r.status === "OPEN" ? <Badge tone="warning">Por decidir</Badge> : <Badge tone="success">OC: {r.purchaseOrders.map((p) => p.number).join(", ")}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
