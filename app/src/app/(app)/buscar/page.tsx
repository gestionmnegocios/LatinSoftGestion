import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import { prisma, ilike } from "@/server/db";
import { PageHeader, Card, Empty } from "@/components/ui";

export const metadata = { title: "Buscar" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { ctx } = await requireSession();
  const q = ((await searchParams).q ?? "").trim();
  const O = ctx.orgId;
  if (q) {
    // Código de barras / SKU exacto → directo a la ficha (flujo escanear → buscar)
    const exact = await prisma.product.findFirst({ where: { organizationId: O, OR: [{ barcode: q }, { sku: q.toUpperCase() }] } });
    if (exact) redirect(`/inventario/productos/${exact.id}`);
  }
  const like = ilike(q);
  const [products, customers, suppliers, quotes, orders, pos, invoices] = q ? await Promise.all([
    prisma.product.findMany({ where: { organizationId: O, OR: [{ name: like }, { sku: like }, { barcode: like }] }, take: 8 }),
    prisma.customer.findMany({ where: { organizationId: O, OR: [{ name: like }, { documentNumber: like }] }, take: 6 }),
    prisma.supplier.findMany({ where: { organizationId: O, OR: [{ legalName: like }, { tradeName: like }, { taxId: like }] }, take: 6 }),
    prisma.quotation.findMany({ where: { organizationId: O, number: like }, take: 6 }),
    prisma.salesOrder.findMany({ where: { organizationId: O, number: like }, take: 6 }),
    prisma.purchaseOrder.findMany({ where: { organizationId: O, number: like }, take: 6 }),
    prisma.invoice.findMany({ where: { organizationId: O, number: like }, take: 6 }),
  ]) : [[], [], [], [], [], [], []];
  const groups = [
    { title: "Productos", items: products.map((p) => ({ href: `/inventario/productos/${p.id}`, label: p.name, sub: `${p.sku} · ${p.barcode ?? ""}` })) },
    { title: "Clientes", items: customers.map((c) => ({ href: `/ventas/clientes/${c.id}`, label: c.name, sub: c.documentNumber })) },
    { title: "Proveedores", items: suppliers.map((s) => ({ href: `/proveedores/${s.id}`, label: s.tradeName ?? s.legalName, sub: s.taxId })) },
    { title: "Documentos", items: [
      ...quotes.map((d) => ({ href: `/ventas/cotizaciones/${d.id}`, label: d.number, sub: "Cotización" })),
      ...orders.map((d) => ({ href: `/ventas/pedidos/${d.id}`, label: d.number, sub: "Pedido" })),
      ...pos.map((d) => ({ href: `/compras/ordenes/${d.id}`, label: d.number, sub: "Orden de compra" })),
      ...invoices.map((d) => ({ href: `/ventas/facturas/${d.id}`, label: d.number, sub: "Factura" })),
    ] },
  ].filter((g) => g.items.length);
  return (
    <div>
      <PageHeader title="Buscar" subtitle="Productos (nombre, SKU, código de barras), clientes, proveedores y documentos" />
      <form className="mb-4 max-w-xl"><input name="q" defaultValue={q} autoFocus className="input py-2.5" placeholder="Escriba o escanee un código…" /></form>
      {!q ? null : groups.length === 0 ? <div className="card"><Empty>Sin resultados para “{q}”.</Empty></div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.title} title={g.title}>
              <ul className="divide-y divide-line-200">
                {g.items.map((i) => <li key={i.href}><Link href={i.href} className="flex justify-between py-2 text-[13px] hover:text-brand-600"><span className="font-medium">{i.label}</span><span className="text-ink-500">{i.sub}</span></Link></li>)}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
