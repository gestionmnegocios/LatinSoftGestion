import { requireSession, can } from "@/server/auth";
import { prisma } from "@/server/db";
import { getProductOptions } from "@/server/queries";
import { PageHeader, Card, Empty } from "@/components/ui";
import { TransferForm } from "./TransferForm";
import { num, dateTime } from "@/lib/format";

export const metadata = { title: "Transferencias" };

export default async function TransfersPage() {
  const s = await requireSession("inventario");
  const [transfers, products] = await Promise.all([
    prisma.transfer.findMany({ where: { organizationId: s.ctx.orgId }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    getProductOptions(s.ctx.orgId, s.ctx.warehouseId),
  ]);
  const names = new Map(products.map((p) => [p.id, p.name]));
  const wh = new Map(s.warehouses.map((w) => [w.id, w.name]));
  return (
    <div>
      <PageHeader title="Transferencias" subtitle="Mover mercancía entre bodegas (genera salida y entrada en el Kardex)" />
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        {can(s, "inventory.transfer") ? (
          <Card title="Nueva transferencia"><TransferForm warehouses={s.warehouses} fromId={s.ctx.warehouseId} products={products} /></Card>
        ) : <Card title="Nueva transferencia"><p className="text-ink-500">Su rol no permite transferir inventario.</p></Card>}
        <Card title="Historial" bodyClassName="overflow-x-auto">
          {transfers.length === 0 ? <Empty>Sin transferencias.</Empty> : (
            <table className="table">
              <thead><tr><th>Número</th><th>Fecha</th><th>Origen → Destino</th><th>Productos</th></tr></thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td className="font-semibold">{t.number}</td>
                    <td className="whitespace-nowrap">{dateTime(t.createdAt)}</td>
                    <td>{wh.get(t.fromWarehouseId)} → {wh.get(t.toWarehouseId)}</td>
                    <td className="text-xs">{t.items.map((i) => `${names.get(i.productId)} (${num(i.quantity)})`).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
