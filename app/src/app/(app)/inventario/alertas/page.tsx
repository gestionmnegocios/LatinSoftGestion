import Link from "next/link";
import { AlertTriangle, XCircle, PackageX, Clock, Truck, CalendarClock } from "lucide-react";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getStockRows } from "@/server/services/inventory";
import { PageHeader, Card, KpiCard, Badge } from "@/components/ui";
import { num, date, money } from "@/lib/format";

export const metadata = { title: "Alertas" };

export default async function AlertsPage() {
  const s = await requireSession("inventario");
  const O = s.ctx.orgId;
  const now = new Date();
  const [rows, ordersShort, latePOs, unconfirmedPOs, expiring, overdueInvoices] = await Promise.all([
    getStockRows(O, s.ctx.warehouseId),
    prisma.salesOrder.findMany({ where: { organizationId: O, status: { in: ["CONFIRMED", "PREPARING", "PARTIAL"] } }, include: { customer: true, items: { include: { product: true } } } }),
    prisma.purchaseOrder.findMany({ where: { organizationId: O, status: { in: ["CONFIRMED", "IN_TRANSIT", "PARTIALLY_RECEIVED"] }, expectedDate: { lt: now } }, include: { supplier: true } }),
    prisma.purchaseOrder.findMany({ where: { organizationId: O, status: "SENT" }, include: { supplier: true } }),
    prisma.goodsReceiptItem.findMany({ where: { goodsReceipt: { organizationId: O }, expirationDate: { not: null, lte: new Date(now.getTime() + 60 * 86400000) } }, include: { product: true }, orderBy: { expirationDate: "asc" }, take: 20 }),
    prisma.invoice.findMany({ where: { organizationId: O, status: { in: ["ISSUED", "PARTIAL"] }, dueDate: { lt: now } }, include: { customer: true } }),
  ]);
  const out = rows.filter((r) => r.status === "OUT_OF_STOCK");
  const low = rows.filter((r) => r.status === "LOW");
  const over = rows.filter((r) => r.status === "OVERSTOCK");
  const shortOrders = ordersShort.filter((o) => o.items.some((i) => i.quantity > i.reservedQuantity + i.fulfilledQuantity));
  const byCustomer = new Map<string, { name: string; amount: number; limit: number }>();
  for (const i of overdueInvoices) {
    const e = byCustomer.get(i.customerId) ?? { name: i.customer.name, amount: 0, limit: i.customer.creditLimit };
    e.amount += i.total - i.paidAmount;
    byCustomer.set(i.customerId, e);
  }

  return (
    <div>
      <PageHeader title="Alertas" subtitle="Excepciones que requieren acción" actions={<Link href="/compras/necesidades" className="btn-primary">Ir a necesidades de compra</Link>} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Agotados" value={num(out.length)} icon={XCircle} tone="red" />
        <KpiCard label="Stock bajo" value={num(low.length)} icon={AlertTriangle} tone="orange" />
        <KpiCard label="Pedidos con faltante" value={num(shortOrders.length)} icon={PackageX} tone="red" />
        <KpiCard label="Compras retrasadas" value={num(latePOs.length)} icon={Clock} tone="orange" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Productos agotados y bajo mínimo" bodyClassName="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Producto</th><th className="text-right">Disponible</th><th className="text-right">Mínimo</th><th className="text-right">En tránsito</th><th>Estado</th></tr></thead>
            <tbody>
              {[...out, ...low].map((r) => (
                <tr key={r.productId}>
                  <td><Link href={`/inventario/productos/${r.productId}`} className="hover:text-brand-600">{r.name}</Link></td>
                  <td className="num text-right font-semibold text-danger">{num(r.available)}</td>
                  <td className="num text-right">{num(r.minimumStock)}</td>
                  <td className="num text-right">{r.incoming ? num(r.incoming) : "—"}</td>
                  <td>{r.status === "OUT_OF_STOCK" ? <Badge tone="danger">Agotado</Badge> : <Badge tone="warning">Bajo</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Pedidos pendientes por faltante" bodyClassName="overflow-x-auto">
          {shortOrders.length === 0 ? <p className="p-4 text-[13px] text-ink-500">Ningún pedido tiene faltantes.</p> : (
            <table className="table">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Faltantes</th></tr></thead>
              <tbody>
                {shortOrders.map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/ventas/pedidos/${o.id}`} className="font-semibold text-brand-600">{o.number}</Link></td>
                    <td>{o.customer.name}</td>
                    <td className="text-xs">{o.items.filter((i) => i.quantity > i.reservedQuantity + i.fulfilledQuantity).map((i) => `${i.product.name}: ${num(i.quantity - i.reservedQuantity - i.fulfilledQuantity)}`).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Compras retrasadas y sin confirmar" bodyClassName="overflow-x-auto">
          <table className="table">
            <thead><tr><th>OC</th><th>Proveedor</th><th>Situación</th></tr></thead>
            <tbody>
              {latePOs.length + unconfirmedPOs.length === 0 && <tr><td colSpan={3} className="text-ink-500">Sin novedades.</td></tr>}
              {latePOs.map((p) => <tr key={p.id}><td><Link href={`/compras/ordenes/${p.id}`} className="text-brand-600">{p.number}</Link></td><td>{p.supplier.tradeName ?? p.supplier.legalName}</td><td><Badge tone="danger"><Truck size={11} /> Retrasada desde {date(p.expectedDate)}</Badge></td></tr>)}
              {unconfirmedPOs.map((p) => <tr key={p.id}><td><Link href={`/compras/ordenes/${p.id}`} className="text-brand-600">{p.number}</Link></td><td>{p.supplier.tradeName ?? p.supplier.legalName}</td><td><Badge tone="warning">Enviada sin confirmar</Badge></td></tr>)}
            </tbody>
          </table>
        </Card>
        <Card title="Próximos a vencer (60 días) y sobreinventario" bodyClassName="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Producto</th><th>Detalle</th></tr></thead>
            <tbody>
              {expiring.map((e) => <tr key={e.id}><td>{e.product.name}</td><td><Badge tone="warning"><CalendarClock size={11} /> Lote {e.lotNumber} vence {date(e.expirationDate)}</Badge></td></tr>)}
              {over.map((r) => <tr key={r.productId}><td>{r.name}</td><td><Badge tone="info">Sobrestock: {num(r.onHand)} (máx. {num(r.maximumStock)})</Badge></td></tr>)}
              {expiring.length + over.length === 0 && <tr><td colSpan={2} className="text-ink-500">Sin novedades.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card title="Cartera vencida / clientes que exceden cupo" className="xl:col-span-2" bodyClassName="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Cliente</th><th className="text-right">Vencido</th><th className="text-right">Cupo</th><th /></tr></thead>
            <tbody>
              {[...byCustomer.entries()].map(([id, c]) => <tr key={id}><td><Link href={`/ventas/clientes/${id}`} className="hover:text-brand-600">{c.name}</Link></td><td className="num text-right font-semibold text-danger">{money(c.amount)}</td><td className="num text-right">{c.limit ? money(c.limit) : "Contado"}</td><td>{c.limit && c.amount > c.limit ? <Badge tone="danger">Excede cupo</Badge> : <Badge tone="warning">Factura vencida</Badge>}</td></tr>)}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
