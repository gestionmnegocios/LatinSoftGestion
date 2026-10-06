import { requireSession, can } from "@/server/auth";
import { prisma } from "@/server/db";
import { MOVEMENT_LABELS } from "@/server/services/inventory";
import { PageHeader, Pagination, Empty } from "@/components/ui";
import { money, num, dateTime } from "@/lib/format";

export const metadata = { title: "Movimientos (Kardex)" };
const PER = 30;

export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ producto?: string; tipo?: string; bodega?: string; desde?: string; hasta?: string; p?: string; reservas?: string }> }) {
  const s = await requireSession("inventario");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p ?? 1));
  const where = {
    organizationId: s.ctx.orgId,
    ...(sp.producto ? { productId: sp.producto } : {}),
    ...(sp.bodega ? { warehouseId: sp.bodega } : {}),
    ...(sp.tipo ? { movementType: sp.tipo } : sp.reservas ? {} : { movementType: { notIn: ["RESERVATION", "RESERVATION_RELEASE"] } }),
    ...(sp.desde || sp.hasta ? { createdAt: { ...(sp.desde ? { gte: new Date(sp.desde + "T00:00:00-05:00") } : {}), ...(sp.hasta ? { lte: new Date(sp.hasta + "T23:59:59-05:00") } : {}) } } : {}),
  };
  const [rows, total, products] = await Promise.all([
    prisma.inventoryMovement.findMany({ where, include: { product: true, warehouse: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }),
    prisma.inventoryMovement.count({ where }),
    prisma.product.findMany({ where: { organizationId: s.ctx.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true } }),
  ]);
  const showCost = can(s, "finance.view_cost");
  const qs = (p: number) => `/inventario/movimientos?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "p")) as Record<string, string>, p: String(p) })}`;
  return (
    <div>
      <PageHeader title="Movimientos (Kardex)" subtitle="Todo cambio de inventario es trazable: cantidad anterior, movimiento, resultante, costo, documento y usuario" />
      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_150px_150px_auto]">
        <select name="producto" defaultValue={sp.producto ?? ""} className="input"><option value="">Todos los productos</option>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select>
        <select name="tipo" defaultValue={sp.tipo ?? ""} className="input"><option value="">Todos los tipos</option>{Object.entries(MOVEMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="bodega" defaultValue={sp.bodega ?? ""} className="input"><option value="">Todas las bodegas</option>{s.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <input type="date" name="desde" defaultValue={sp.desde} className="input" aria-label="Desde" />
        <input type="date" name="hasta" defaultValue={sp.hasta} className="input" aria-label="Hasta" />
        <button className="btn-primary">Filtrar</button>
        <label className="flex items-center gap-2 text-xs text-ink-500 sm:col-span-2"><input type="checkbox" name="reservas" value="1" defaultChecked={!!sp.reservas} className="accent-brand-600" /> Incluir reservas y liberaciones</label>
      </form>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty>Sin movimientos.</Empty> : (
          <table className="table min-w-[1000px]">
            <thead><tr><th>Fecha / hora</th><th>Producto</th><th>Bodega</th><th>Tipo</th><th>Documento origen</th><th className="text-right">Anterior</th><th className="text-right">Movimiento</th><th className="text-right">Resultante</th>{showCost && <th className="text-right">Costo unit.</th>}{showCost && <th className="text-right">Costo total</th>}<th>Usuario</th></tr></thead>
            <tbody>
              {rows.map((m) => {
                const res = m.movementType.startsWith("RESERVATION");
                return (
                  <tr key={m.id} className={res ? "text-ink-500" : ""}>
                    <td className="whitespace-nowrap">{dateTime(m.createdAt)}</td>
                    <td><div className="font-medium">{m.product.name}</div><div className="font-mono text-[11px] text-ink-500">{m.product.sku}</div></td>
                    <td>{m.warehouse.name}</td>
                    <td>{MOVEMENT_LABELS[m.movementType]}</td>
                    <td className="text-xs">{m.referenceNumber ?? "—"}{m.lotNumber && <div className="text-ink-500">Lote {m.lotNumber}</div>}{m.notes && <div className="text-ink-500">{m.notes}</div>}</td>
                    <td className="num text-right">{num(m.previousQuantity)}</td>
                    <td className={`num text-right font-semibold ${res ? "" : m.quantity > 0 ? "text-success" : "text-danger"}`}>{res ? `${m.movementType === "RESERVATION" ? "−" : "+"}${num(m.quantity)} disp.` : `${m.quantity > 0 ? "+" : ""}${num(m.quantity)}`}</td>
                    <td className="num text-right">{num(m.resultingQuantity)}</td>
                    {showCost && <td className="num text-right">{money(m.unitCost)}</td>}
                    {showCost && <td className="num text-right">{money(m.totalCost)}</td>}
                    <td className="text-xs text-ink-500">{m.userName}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pagination page={page} pages={Math.ceil(total / PER)} total={total} shown={rows.length} makeHref={qs} />
      </div>
    </div>
  );
}
