import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, StatusBadge, Tabs, Empty, Pagination } from "@/components/ui";
import { money, date, PO_STATUS } from "@/lib/format";

export const metadata = { title: "Órdenes de compra" };
const PER = 20;

export default async function POList({ searchParams }: { searchParams: Promise<{ estado?: string; p?: string }> }) {
  const { ctx } = await requireSession("compras");
  const sp = await searchParams;
  const estado = sp.estado ?? "abiertas";
  const page = Math.max(1, Number(sp.p ?? 1));
  const filters: Record<string, string[] | undefined> = {
    abiertas: ["DRAFT", "SENT", "CONFIRMED", "IN_TRANSIT", "PARTIALLY_RECEIVED"],
    recibidas: ["RECEIVED", "CLOSED"],
    canceladas: ["CANCELLED"],
    todas: undefined,
  };
  const where = { organizationId: ctx.orgId, ...(filters[estado] ? { status: { in: filters[estado] } } : {}) };
  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, include: { supplier: true, _count: { select: { items: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }),
    prisma.purchaseOrder.count({ where }),
  ]);
  const now = new Date();
  return (
    <div>
      <PageHeader title="Órdenes de compra" subtitle="Borrador → Enviada → Confirmada → En tránsito → Recibida → Cerrada" actions={<Link href="/compras/ordenes/nueva" className="btn-primary"><Plus size={15} /> Nueva OC</Link>} />
      <div className="mb-4">
        <Tabs active={estado} tabs={Object.keys(filters).map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), href: `/compras/ordenes?estado=${k}` }))} />
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty>No hay órdenes con este filtro.</Empty> : (
          <table className="table min-w-[800px]">
            <thead><tr><th>OC</th><th>Proveedor</th><th>Fecha</th><th>Entrega esperada</th><th className="text-right">Ítems</th><th className="text-right">Total</th><th>Estado</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const late = p.expectedDate && p.expectedDate < now && ["CONFIRMED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "SENT"].includes(p.status);
                return (
                  <tr key={p.id}>
                    <td><Link className="font-semibold text-brand-600" href={`/compras/ordenes/${p.id}`}>{p.number}</Link></td>
                    <td>{p.supplier.tradeName ?? p.supplier.legalName}</td>
                    <td>{date(p.orderDate)}</td>
                    <td className={late ? "font-semibold text-danger" : ""}>{date(p.expectedDate)}{late ? " (retrasada)" : ""}</td>
                    <td className="num text-right">{p._count.items}</td>
                    <td className="num text-right font-medium">{money(p.total)}</td>
                    <td><StatusBadge map={PO_STATUS} value={p.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pagination page={page} pages={Math.ceil(total / PER)} total={total} shown={rows.length} makeHref={(p) => `/compras/ordenes?estado=${estado}&p=${p}`} />
      </div>
    </div>
  );
}
