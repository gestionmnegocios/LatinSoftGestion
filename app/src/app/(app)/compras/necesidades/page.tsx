import Link from "next/link";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { calculateRequirements } from "@/server/services/procurement";
import { PageHeader, Card, Badge } from "@/components/ui";
import { RequirementsTable } from "./RequirementsTable";
import { date } from "@/lib/format";

export const metadata = { title: "Necesidades de compra" };

export default async function RequirementsPage({ searchParams }: { searchParams: Promise<{ h?: string; tab?: string }> }) {
  const s = await requireSession("compras");
  const sp = await searchParams;
  const horizon = [7, 15, 30, 60].includes(Number(sp.h)) ? Number(sp.h) : 30;
  const [rows, open] = await Promise.all([
    calculateRequirements(s.ctx.orgId, s.ctx.warehouseId, horizon),
    prisma.purchaseRequirement.findMany({ where: { organizationId: s.ctx.orgId }, include: { _count: { select: { items: true } }, purchaseOrders: { select: { id: true, number: true } } }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  return (
    <div>
      <PageHeader
        title="Necesidades de compra"
        subtitle="Productos que requieren reposición · calculado por el motor de abastecimiento"
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-line-200 bg-white p-1 text-[13px]">
            <span className="px-2 text-ink-500">Cubrir</span>
            {[7, 15, 30, 60].map((h) => <Link key={h} href={`?h=${h}`} className={`rounded-md px-2.5 py-1 font-medium ${h === horizon ? "bg-brand-600 text-white" : "hover:bg-surface-100"}`}>{h} días</Link>)}
          </div>
        }
      />
      <RequirementsTable rows={rows} horizon={horizon} warehouseId={s.ctx.warehouseId} initialTab={sp.tab ?? "todos"} />
      <Card title="Necesidades generadas" className="mt-4" bodyClassName="overflow-x-auto">
        {open.length === 0 ? <p className="p-4 text-ink-500">Aún no se han generado necesidades.</p> : (
          <table className="table">
            <thead><tr><th>Número</th><th>Fecha</th><th className="text-right">Productos</th><th>Estado</th><th>Órdenes de compra</th></tr></thead>
            <tbody>
              {open.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/compras/comparador/${r.id}`} className="font-semibold text-brand-600">{r.number}</Link></td>
                  <td>{date(r.createdAt)}</td>
                  <td className="num text-right">{r._count.items}</td>
                  <td>{r.status === "OPEN" ? <Badge tone="warning">Por comparar</Badge> : r.status === "ORDERED" ? <Badge tone="success">Con OC</Badge> : <Badge>Cancelada</Badge>}</td>
                  <td className="text-xs">{r.purchaseOrders.map((p) => <Link key={p.id} href={`/compras/ordenes/${p.id}`} className="mr-2 text-brand-600">{p.number}</Link>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
