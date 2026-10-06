import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, Empty, Badge } from "@/components/ui";
import { money } from "@/lib/format";

export const metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { ctx } = await requireSession("ventas");
  const { q } = await searchParams;
  const customers = await prisma.customer.findMany({
    where: { organizationId: ctx.orgId, ...(q ? { OR: [{ name: { contains: q } }, { documentNumber: { contains: q } }, { contactName: { contains: q } }] } : {}) },
    include: { invoices: { where: { status: { in: ["ISSUED", "PARTIAL"] } }, select: { total: true, paidAmount: true, dueDate: true } }, _count: { select: { salesOrders: true } } },
    orderBy: { name: "asc" },
  });
  const now = new Date();
  return (
    <div>
      <PageHeader title="Clientes" subtitle="Cartera, cupos y condiciones comerciales" actions={<Link href="/ventas/clientes/nuevo" className="btn-primary"><Plus size={15} /> Nuevo cliente</Link>} />
      <form className="mb-4 max-w-sm"><input name="q" defaultValue={q} className="input" placeholder="Buscar por nombre, NIT o contacto…" /></form>
      <div className="card overflow-x-auto">
        {customers.length === 0 ? <Empty>No hay clientes.</Empty> : (
          <table className="table min-w-[860px]">
            <thead><tr><th>Cliente</th><th>Documento</th><th>Contacto</th><th>Ciudad</th><th className="text-right">Pedidos</th><th className="text-right">Cupo</th><th className="text-right">Saldo</th><th>Cartera</th></tr></thead>
            <tbody>
              {customers.map((c) => {
                const balance = c.invoices.reduce((s, i) => s + i.total - i.paidAmount, 0);
                const overdue = c.invoices.some((i) => i.dueDate < now);
                const over = c.creditLimit > 0 && balance > c.creditLimit;
                return (
                  <tr key={c.id}>
                    <td><Link href={`/ventas/clientes/${c.id}`} className="font-semibold text-brand-600">{c.name}</Link></td>
                    <td>{c.documentType} {c.documentNumber}</td>
                    <td>{c.contactName}<div className="text-xs text-ink-500">{c.phone}</div></td>
                    <td>{c.city}</td>
                    <td className="num text-right">{c._count.salesOrders}</td>
                    <td className="num text-right">{c.creditLimit ? money(c.creditLimit) : "Contado"}</td>
                    <td className="num text-right font-medium">{money(balance)}</td>
                    <td>{over ? <Badge tone="danger">Excede cupo</Badge> : overdue ? <Badge tone="warning">En mora</Badge> : <Badge tone="success">Al día</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
