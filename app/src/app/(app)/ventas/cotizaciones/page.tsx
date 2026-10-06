import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { searchIds } from "@/server/search";
import { PageHeader, StatusBadge, Tabs, Empty, Pagination } from "@/components/ui";
import { money, date, QUOTE_STATUS } from "@/lib/format";

export const metadata = { title: "Cotizaciones" };
const PER = 20;

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ estado?: string; q?: string; p?: string }> }) {
  const { ctx } = await requireSession("ventas");
  const sp = await searchParams;
  const estado = sp.estado ?? "todas";
  const page = Math.max(1, Number(sp.p ?? 1));
  const statusFilter: Record<string, string[] | undefined> = { todas: undefined, abiertas: ["DRAFT", "SENT"], convertidas: ["CONVERTED"], cerradas: ["REJECTED", "EXPIRED"] };
  const where = {
    organizationId: ctx.orgId,
    ...(statusFilter[estado] ? { status: { in: statusFilter[estado] } } : {}),
    ...(sp.q ? { OR: [{ id: { in: await searchIds("Quotation", ctx.orgId, sp.q) } }, { customerId: { in: await searchIds("Customer", ctx.orgId, sp.q) } }] } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    prisma.quotation.findMany({ where, include: { customer: true, _count: { select: { items: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }),
    prisma.quotation.count({ where }),
    prisma.quotation.groupBy({ by: ["status"], where: { organizationId: ctx.orgId }, _count: true }),
  ]);
  const c = (s: string[]) => counts.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count, 0);
  const href = (e: string, p = 1) => `/ventas/cotizaciones?estado=${e}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}&p=${p}`;
  return (
    <div>
      <PageHeader title="Cotizaciones" subtitle="Propuestas comerciales con verificación de disponibilidad" actions={<Link href="/ventas/cotizaciones/nueva" className="btn-primary"><Plus size={15} /> Nueva cotización</Link>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs active={estado} tabs={[
          { key: "todas", label: "Todas", href: href("todas"), count: c(Object.keys(QUOTE_STATUS)) },
          { key: "abiertas", label: "Abiertas", href: href("abiertas"), count: c(["DRAFT", "SENT"]) },
          { key: "convertidas", label: "Convertidas", href: href("convertidas"), count: c(["CONVERTED"]) },
          { key: "cerradas", label: "Rechazadas / vencidas", href: href("cerradas"), count: c(["REJECTED", "EXPIRED"]) },
        ]} />
        <form className="w-full sm:w-72"><input type="hidden" name="estado" value={estado} /><input name="q" defaultValue={sp.q} className="input" placeholder="Buscar número o cliente…" /></form>
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty>No hay cotizaciones con estos filtros.</Empty> : (
          <table className="table min-w-[760px]">
            <thead><tr><th>Número</th><th>Cliente</th><th>Fecha</th><th>Vence</th><th>Vendedor</th><th className="text-right">Ítems</th><th className="text-right">Total</th><th>Estado</th></tr></thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id}>
                  <td><Link className="font-semibold text-brand-600" href={`/ventas/cotizaciones/${q.id}`}>{q.number}</Link></td>
                  <td>{q.customer.name}</td>
                  <td>{date(q.issueDate)}</td>
                  <td>{date(q.expirationDate)}</td>
                  <td className="text-ink-500">{q.salespersonName ?? "—"}</td>
                  <td className="num text-right">{q._count.items}</td>
                  <td className="num text-right font-medium">{money(q.total)}</td>
                  <td><StatusBadge map={QUOTE_STATUS} value={q.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} pages={Math.ceil(total / PER)} total={total} shown={rows.length} makeHref={(p) => href(estado, p)} />
      </div>
    </div>
  );
}
