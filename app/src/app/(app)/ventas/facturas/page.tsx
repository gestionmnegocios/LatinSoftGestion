import Link from "next/link";
import { requireSession } from "@/server/auth";
import { prisma, ilike } from "@/server/db";
import { PageHeader, StatusBadge, Tabs, Empty, Pagination, KpiCard } from "@/components/ui";
import { money, date, INVOICE_STATUS } from "@/lib/format";
import { Receipt, AlertTriangle, CheckCircle2 } from "lucide-react";

export const metadata = { title: "Facturas" };
const PER = 20;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ estado?: string; q?: string; p?: string }> }) {
  const { ctx } = await requireSession("ventas");
  const sp = await searchParams;
  const estado = sp.estado ?? "pendientes";
  const page = Math.max(1, Number(sp.p ?? 1));
  const now = new Date();
  const base = { organizationId: ctx.orgId };
  const where = {
    ...base,
    ...(estado === "pendientes" ? { status: { in: ["ISSUED", "PARTIAL"] } } : estado === "vencidas" ? { status: { in: ["ISSUED", "PARTIAL"] }, dueDate: { lt: now } } : estado === "pagadas" ? { status: "PAID" } : {}),
    ...(sp.q ? { OR: [{ number: ilike(sp.q) }, { customer: { name: ilike(sp.q) } }] } : {}),
  };
  const [rows, total, open] = await Promise.all([
    prisma.invoice.findMany({ where, include: { customer: true, salesOrder: { select: { number: true } } }, orderBy: { issueDate: "desc" }, skip: (page - 1) * PER, take: PER }),
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({ where: { ...base, status: { in: ["ISSUED", "PARTIAL"] } }, select: { total: true, paidAmount: true, dueDate: true } }),
  ]);
  const receivable = open.reduce((s, i) => s + i.total - i.paidAmount, 0);
  const overdue = open.filter((i) => i.dueDate < now);
  const href = (e: string, p = 1) => `/ventas/facturas?estado=${e}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}&p=${p}`;
  return (
    <div>
      <PageHeader title="Facturas" subtitle="Facturación de pedidos despachados y cartera" />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Cuentas por cobrar" value={money(receivable)} icon={Receipt} tone="blue" hint={`${open.length} facturas abiertas`} />
        <KpiCard label="Vencidas" value={money(overdue.reduce((s, i) => s + i.total - i.paidAmount, 0))} icon={AlertTriangle} tone="red" hint={`${overdue.length} facturas`} />
        <KpiCard label="Al día" value={money(receivable - overdue.reduce((s, i) => s + i.total - i.paidAmount, 0))} icon={CheckCircle2} tone="green" />
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs active={estado} tabs={[
          { key: "pendientes", label: "Por cobrar", href: href("pendientes") },
          { key: "vencidas", label: "Vencidas", href: href("vencidas"), count: overdue.length },
          { key: "pagadas", label: "Pagadas", href: href("pagadas") },
          { key: "todas", label: "Todas", href: href("todas") },
        ]} />
        <form className="w-full sm:w-72"><input type="hidden" name="estado" value={estado} /><input name="q" defaultValue={sp.q} className="input" placeholder="Buscar número o cliente…" /></form>
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty>No hay facturas con estos filtros.</Empty> : (
          <table className="table min-w-[800px]">
            <thead><tr><th>Factura</th><th>Pedido</th><th>Cliente</th><th>Emisión</th><th>Vence</th><th className="text-right">Total</th><th className="text-right">Saldo</th><th>Estado</th></tr></thead>
            <tbody>
              {rows.map((i) => {
                const late = i.status !== "PAID" && i.dueDate < now;
                return (
                  <tr key={i.id}>
                    <td><Link className="font-semibold text-brand-600" href={`/ventas/facturas/${i.id}`}>{i.number}</Link></td>
                    <td className="text-ink-500">{i.salesOrder.number}</td>
                    <td>{i.customer.name}</td>
                    <td>{date(i.issueDate)}</td>
                    <td className={late ? "font-semibold text-danger" : ""}>{date(i.dueDate)}</td>
                    <td className="num text-right">{money(i.total)}</td>
                    <td className="num text-right font-medium">{money(i.total - i.paidAmount)}</td>
                    <td><StatusBadge map={INVOICE_STATUS} value={late ? "OVERDUE" : i.status} /></td>
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
