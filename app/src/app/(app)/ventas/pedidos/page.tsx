import Link from "next/link";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { searchIds } from "@/server/search";
import { PageHeader, StatusBadge, Tabs, Empty, Pagination, Badge } from "@/components/ui";
import { money, date, ORDER_STATUS } from "@/lib/format";

export const metadata = { title: "Pedidos" };
const PER = 20;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ estado?: string; q?: string; p?: string }> }) {
  const { ctx } = await requireSession("ventas");
  const sp = await searchParams;
  const estado = sp.estado ?? "pendientes";
  const page = Math.max(1, Number(sp.p ?? 1));
  const filters: Record<string, string[] | undefined> = {
    pendientes: ["CONFIRMED", "PREPARING", "READY", "PARTIAL"],
    despachados: ["DISPATCHED", "DELIVERED"],
    cancelados: ["CANCELLED"],
    todos: undefined,
  };
  const where = {
    organizationId: ctx.orgId,
    ...(filters[estado] ? { status: { in: filters[estado] } } : {}),
    ...(sp.q ? { OR: [{ id: { in: await searchIds("SalesOrder", ctx.orgId, sp.q) } }, { customerId: { in: await searchIds("Customer", ctx.orgId, sp.q) } }] } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    prisma.salesOrder.findMany({ where, include: { customer: true, items: true, quotation: { select: { number: true } }, invoice: { select: { number: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }),
    prisma.salesOrder.count({ where }),
    prisma.salesOrder.groupBy({ by: ["status"], where: { organizationId: ctx.orgId }, _count: true }),
  ]);
  const c = (s?: string[]) => counts.filter((x) => !s || s.includes(x.status)).reduce((a, x) => a + x._count, 0);
  const href = (e: string, p = 1) => `/ventas/pedidos?estado=${e}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}&p=${p}`;
  return (
    <div>
      <PageHeader title="Pedidos" subtitle="Reserva, preparación y despacho" actions={<Link href="/ventas/cotizaciones/nueva" className="btn-primary">Nueva cotización</Link>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs active={estado} tabs={[
          { key: "pendientes", label: "Pendientes", href: href("pendientes"), count: c(filters.pendientes) },
          { key: "despachados", label: "Despachados", href: href("despachados"), count: c(filters.despachados) },
          { key: "cancelados", label: "Cancelados", href: href("cancelados"), count: c(filters.cancelados) },
          { key: "todos", label: "Todos", href: href("todos"), count: c() },
        ]} />
        <form className="w-full sm:w-72"><input type="hidden" name="estado" value={estado} /><input name="q" defaultValue={sp.q} className="input" placeholder="Buscar número o cliente…" /></form>
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty>No hay pedidos con estos filtros.</Empty> : (
          <table className="table min-w-[800px]">
            <thead><tr><th>Pedido</th><th>Cotización</th><th>Cliente</th><th>Fecha</th><th className="text-right">Total</th><th>Inventario</th><th>Estado</th><th>Factura</th></tr></thead>
            <tbody>
              {rows.map((o) => {
                const pending = o.items.reduce((s, i) => s + Math.max(0, i.quantity - i.reservedQuantity - i.fulfilledQuantity), 0);
                const open = ["CONFIRMED", "PREPARING", "READY", "PARTIAL"].includes(o.status);
                return (
                  <tr key={o.id}>
                    <td><Link className="font-semibold text-brand-600" href={`/ventas/pedidos/${o.id}`}>{o.number}</Link></td>
                    <td className="text-ink-500">{o.quotation?.number ?? "—"}</td>
                    <td>{o.customer.name}</td>
                    <td>{date(o.createdAt)}</td>
                    <td className="num text-right font-medium">{money(o.total)}</td>
                    <td>{open ? (pending > 0 ? <Badge tone="danger">Faltan {pending}</Badge> : <Badge tone="success">Reservado</Badge>) : <span className="text-ink-500">—</span>}</td>
                    <td><StatusBadge map={ORDER_STATUS} value={o.status} /></td>
                    <td className="text-ink-500">{o.invoice?.number ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pagination page={page} pages={Math.ceil(total / PER)} total={total} shown={rows.length} makeHref={(p) => href(estado, p)} />
      </div>
    </div>
  );
}
