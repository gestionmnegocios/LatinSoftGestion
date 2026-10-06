import Link from "next/link";
import { Plus, Download } from "lucide-react";
import { requireSession, can } from "@/server/auth";
import { prisma } from "@/server/db";
import { getStockRows } from "@/server/services/inventory";
import { PageHeader, StatusBadge, Empty, Pagination } from "@/components/ui";
import { ImportButton } from "./ImportButton";
import { money, num, STOCK_STATUS } from "@/lib/format";
import { matches } from "@/lib/text";

export const metadata = { title: "Productos" };
const PER = 15;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string; estado?: string; p?: string }> }) {
  const s = await requireSession("inventario");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p ?? 1));
  const [rows, categories] = await Promise.all([
    getStockRows(s.ctx.orgId, s.ctx.warehouseId),
    prisma.category.findMany({ where: { organizationId: s.ctx.orgId }, orderBy: { name: "asc" } }),
  ]);
  const barcodes = new Map((await prisma.product.findMany({ where: { organizationId: s.ctx.orgId }, select: { id: true, barcode: true } })).map((p) => [p.id, p.barcode ?? ""]));
  const catName = categories.find((c) => c.id === sp.cat)?.name;
  const q = (sp.q ?? "").trim();
  const filtered = rows.filter((r) =>
    (!q || matches(r.name, q) || matches(r.sku, q) || matches(barcodes.get(r.productId), q)) &&
    (!catName || r.category === catName) &&
    (!sp.estado || r.status === sp.estado),
  );
  const pageRows = filtered.slice((page - 1) * PER, page * PER);
  const showCost = can(s, "finance.view_cost");
  const qs = (p: number) => `/inventario/productos?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.cat ? { cat: sp.cat } : {}), ...(sp.estado ? { estado: sp.estado } : {}), p: String(p) })}`;

  return (
    <div>
      <PageHeader
        title="Productos"
        subtitle="Gestiona tu catálogo de productos"
        actions={
          <>
            {can(s, "products.manage") && <ImportButton />}
            <a href="/api/products?format=csv" className="btn-outline"><Download size={15} /> Exportar</a>
            {can(s, "products.manage") && <Link href="/inventario/productos/nuevo" className="btn-primary"><Plus size={15} /> Nuevo producto</Link>}
          </>
        }
      />
      <div className="card overflow-hidden">
        <form className="grid gap-3 border-b border-line-200 p-4 sm:grid-cols-[1fr_220px_200px_auto]">
          <input name="q" defaultValue={sp.q} className="input" placeholder="Buscar producto, SKU o código de barras…" />
          <select name="cat" defaultValue={sp.cat ?? ""} className="input">
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="estado" defaultValue={sp.estado ?? ""} className="input">
            <option value="">Todos los estados</option>
            {Object.entries(STOCK_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button className="btn-ghost">Filtrar</button>
        </form>
        <div className="overflow-x-auto">
          {pageRows.length === 0 ? <Empty>No se encontraron productos.</Empty> : (
            <table className="table min-w-[900px]">
              <thead>
                <tr><th>SKU</th><th>Producto</th><th>Categoría</th>{showCost && <th className="text-right">Costo</th>}<th className="text-right">Precio venta</th><th className="text-right">Stock</th><th className="text-right">Disponible</th><th className="text-right">En tránsito</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.productId}>
                    <td className="font-mono text-xs">{r.sku}</td>
                    <td><Link href={`/inventario/productos/${r.productId}`} className="font-medium hover:text-brand-600">{r.name}</Link></td>
                    <td className="text-ink-500">{r.category}</td>
                    {showCost && <td className="num text-right">{money(r.averageCost)}</td>}
                    <td className="num text-right">{money(r.salePrice)}</td>
                    <td className="num text-right">{num(r.onHand)}</td>
                    <td className={`num text-right font-semibold ${r.status === "OUT_OF_STOCK" ? "text-danger" : r.status === "LOW" ? "text-warning-ink" : "text-success"}`}>{num(r.available)}</td>
                    <td className="num text-right text-ink-500">{r.incoming ? num(r.incoming) : "—"}</td>
                    <td><StatusBadge map={STOCK_STATUS} value={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} pages={Math.ceil(filtered.length / PER)} total={filtered.length} shown={pageRows.length} makeHref={qs} />
      </div>
    </div>
  );
}
