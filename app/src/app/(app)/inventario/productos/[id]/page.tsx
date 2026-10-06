import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/server/auth";
import { prisma } from "@/server/db";
import { getStockStatus, MOVEMENT_LABELS } from "@/server/services/inventory";
import { PageHeader, Card, StatusBadge, Badge, Stat } from "@/components/ui";
import { EntityForm } from "@/components/EntityForm";
import { AdjustButton } from "@/components/AdjustForm";
import { saveProductAction } from "@/app/actions";
import { productFields, productSections } from "../fields";
import { SupplierOffers } from "./SupplierOffers";
import { money, num, pct, dateTime, STOCK_STATUS } from "@/lib/format";

export default async function ProductDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("inventario");
  const { id } = await params;
  const { tab = "resumen" } = await searchParams;
  const p = await prisma.product.findFirst({
    where: { id, organizationId: s.ctx.orgId },
    include: { category: { include: { parent: true } }, balances: { include: { warehouse: true } }, supplierProducts: { where: { status: "ACTIVE" }, include: { supplier: true }, orderBy: { price: "asc" } }, prices: { include: { priceList: true } } },
  });
  if (!p) notFound();
  const [movements, categories, suppliers, sold90] = await Promise.all([
    prisma.inventoryMovement.findMany({ where: { productId: p.id, organizationId: s.ctx.orgId }, include: { warehouse: true }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.category.findMany({ where: { organizationId: s.ctx.orgId }, include: { parent: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { organizationId: s.ctx.orgId, status: "ACTIVE" }, orderBy: { legalName: "asc" } }),
    prisma.inventoryMovement.aggregate({ where: { productId: p.id, movementType: "SALE", createdAt: { gte: new Date(Date.now() - 90 * 86400000) } }, _sum: { quantity: true } }),
  ]);
  const onHand = p.balances.reduce((a, b) => a + b.onHand, 0);
  const reserved = p.balances.reduce((a, b) => a + b.reserved, 0);
  const incoming = p.balances.reduce((a, b) => a + b.incoming, 0);
  const status = getStockStatus({ onHand, reserved, minimumStock: p.minimumStock, maximumStock: p.maximumStock });
  const margin = p.salePrice ? ((p.salePrice - p.averageCost) / p.salePrice) * 100 : 0;
  const daily = Math.abs(sold90._sum.quantity ?? 0) / 90;
  const showCost = can(s, "finance.view_cost");
  const balances = Object.fromEntries(p.balances.map((b) => [b.warehouseId, { onHand: b.onHand, reserved: b.reserved }]));
  const tabs = [["resumen", "Existencias y Kardex"], ["proveedores", `Proveedores (${p.supplierProducts.length})`], ["editar", "Editar"]];

  return (
    <div>
      <PageHeader
        title={p.name}
        subtitle={<span>SKU {p.sku}{p.barcode ? ` · EAN ${p.barcode}` : ""} · {p.category ? (p.category.parent ? `${p.category.parent.name} › ${p.category.name}` : p.category.name) : "Sin categoría"} <StatusBadge map={STOCK_STATUS} value={status} /></span>}
        back={{ href: "/inventario/productos", label: "Productos" }}
        actions={can(s, "inventory.adjust") ? <AdjustButton productId={p.id} productName={p.name} warehouses={s.warehouses} defaultWarehouseId={s.ctx.warehouseId} balances={balances} label="Ajustar inventario" className="btn-outline" /> : null}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["Stock físico", onHand], ["Comprometido", reserved], ["Disponible", onHand - reserved], ["En tránsito", incoming], ["Proyectado", onHand - reserved + incoming]].map(([l, v]) => (
          <div key={l as string} className="card p-3"><div className="text-xs text-ink-500">{l}</div><div className={`num text-[20px] font-bold ${l === "Disponible" && (v as number) <= p.minimumStock ? "text-danger" : ""}`}>{num(v as number)}</div></div>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium ${tab === k ? "border-brand-500 bg-brand-100 text-brand-600" : "border-line-200 bg-white"}`}>{l}</Link>)}
      </div>

      {tab === "editar" && (
        <div className="max-w-4xl">
          <EntityForm fields={productFields(categories, false)} sections={productSections(false)} initial={{ id: p.id, ...Object.fromEntries(productFields(categories, false).map((f) => [f.name, (p as Record<string, unknown>)[f.name] ?? (f.type === "checkbox" ? false : "")])) }} action={saveProductAction} />
        </div>
      )}

      {tab === "proveedores" && (
        <SupplierOffers
          productId={p.id}
          suppliers={suppliers.map((x) => ({ id: x.id, name: x.tradeName ?? x.legalName, lead: x.averageLeadTime }))}
          offers={p.supplierProducts.map((sp) => ({ id: sp.id, supplierId: sp.supplierId, supplier: sp.supplier.tradeName ?? sp.supplier.legalName, price: sp.price, supplierSku: sp.supplierSku, minimumOrderQuantity: sp.minimumOrderQuantity, leadTimeDays: sp.leadTimeDays, discountPct: sp.discountPct, isPreferred: sp.isPreferred, updatedAt: sp.updatedAt.toISOString() }))}
          averageCost={p.averageCost}
          canEdit={can(s, "suppliers.manage")}
        />
      )}

      {tab === "resumen" && (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Card title="Existencias por bodega" bodyClassName="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Bodega</th><th className="text-right">Físico</th><th className="text-right">Comprometido</th><th className="text-right">Disponible</th><th className="text-right">En tránsito</th></tr></thead>
                <tbody>
                  {s.warehouses.map((w) => {
                    const b = p.balances.find((x) => x.warehouseId === w.id);
                    return <tr key={w.id}><td>{w.name}</td><td className="num text-right">{num(b?.onHand)}</td><td className="num text-right">{num(b?.reserved)}</td><td className="num text-right font-semibold">{num((b?.onHand ?? 0) - (b?.reserved ?? 0))}</td><td className="num text-right">{num(b?.incoming)}</td></tr>;
                  })}
                </tbody>
              </table>
            </Card>
            <Card title="Kardex" actions={<Link href={`/inventario/movimientos?producto=${p.id}`} className="text-xs font-medium text-brand-600">Ver completo</Link>} bodyClassName="overflow-x-auto">
              <table className="table min-w-[760px]">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Bodega</th><th>Documento</th><th className="text-right">Anterior</th><th className="text-right">Movimiento</th><th className="text-right">Resultante</th>{showCost && <th className="text-right">Costo</th>}<th>Usuario</th></tr></thead>
                <tbody>
                  {movements.map((m) => {
                    const reservation = m.movementType.startsWith("RESERVATION");
                    return (
                      <tr key={m.id} className={reservation ? "text-ink-500" : ""}>
                        <td className="whitespace-nowrap">{dateTime(m.createdAt)}</td>
                        <td>{MOVEMENT_LABELS[m.movementType]}</td>
                        <td>{m.warehouse.name}</td>
                        <td className="text-xs">{m.referenceNumber ?? "—"}{m.lotNumber && <div className="text-ink-500">Lote {m.lotNumber}</div>}{m.notes && <div className="text-ink-500">{m.notes}</div>}</td>
                        <td className="num text-right">{num(m.previousQuantity)}</td>
                        <td className={`num text-right font-semibold ${reservation ? "" : m.quantity > 0 ? "text-success" : "text-danger"}`}>{reservation ? `(${m.movementType === "RESERVATION" ? "-" : "+"}${num(m.quantity)} disp.)` : `${m.quantity > 0 ? "+" : ""}${num(m.quantity)}`}</td>
                        <td className="num text-right">{num(m.resultingQuantity)}</td>
                        {showCost && <td className="num text-right">{money(m.unitCost)}</td>}
                        <td className="text-xs text-ink-500">{m.userName}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Comercial">
              {showCost && <Stat label="Costo promedio" value={money(p.averageCost)} />}
              {showCost && <Stat label="Último costo" value={money(p.lastCost)} />}
              {p.prices.map((pr) => <Stat key={pr.id} label={`Precio ${pr.priceList.name}`} value={money(pr.price)} />)}
              <Stat label="IVA" value={`${p.taxRate}%`} />
              {showCost && <Stat label="Margen" value={<Badge tone={margin >= 30 ? "success" : margin >= 15 ? "warning" : "danger"}>{pct(margin)}</Badge>} />}
              {showCost && <Stat label="Inventario valorizado" value={money(onHand * p.averageCost)} />}
            </Card>
            <Card title="Política de inventario">
              <Stat label="Stock mínimo" value={num(p.minimumStock)} />
              <Stat label="Stock de seguridad" value={num(p.safetyStock)} />
              <Stat label="Punto de reorden" value={num(p.reorderPoint)} />
              <Stat label="Stock máximo" value={num(p.maximumStock) || "—"} />
              <Stat label="Venta promedio diaria (90 d)" value={num(daily, 1)} />
              <Stat label="Cobertura disponible" value={daily > 0 ? `${num((onHand - reserved) / daily, 0)} días` : "—"} />
              <Stat label="Ubicación" value={p.location ?? "—"} />
              <Stat label="Lote / vencimiento" value={`${p.trackLot ? "Sí" : "No"} / ${p.trackExpiration ? "Sí" : "No"}`} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export const metadata = { title: "Producto" };
