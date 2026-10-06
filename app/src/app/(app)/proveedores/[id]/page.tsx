import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, Card, StatusBadge, KpiCard } from "@/components/ui";
import { EntityForm } from "@/components/EntityForm";
import { ActionButton } from "@/components/ActionButton";
import { saveSupplierAction, payPayableAction } from "@/app/actions";
import { supplierFields, supplierSections } from "../fields";
import { money, date, PO_STATUS } from "@/lib/format";
import { Package, Truck, Wallet, Clock } from "lucide-react";

export default async function SupplierDetail({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("proveedores");
  const { id } = await params;
  const sup = await prisma.supplier.findFirst({
    where: { id, organizationId: s.ctx.orgId },
    include: { products: { where: { status: "ACTIVE" }, include: { product: true }, orderBy: { product: { name: "asc" } } }, purchaseOrders: { orderBy: { createdAt: "desc" }, take: 10, include: { receipts: true } } },
  });
  if (!sup) notFound();
  const payables = await prisma.accountPayable.findMany({ where: { supplierId: sup.id, organizationId: s.ctx.orgId }, orderBy: { createdAt: "desc" }, take: 10 });
  const owed = payables.filter((p) => p.status === "PENDING").reduce((a, p) => a + p.amount - p.paidAmount, 0);
  // Cumplimiento: % de OC recibidas a tiempo
  const received = sup.purchaseOrders.filter((p) => p.receipts.length && p.expectedDate);
  const onTime = received.filter((p) => p.receipts[0].receivedAt <= new Date(p.expectedDate!.getTime() + 86400000)).length;

  return (
    <div>
      <PageHeader title={sup.tradeName ?? sup.legalName} subtitle={`NIT ${sup.taxId} · ${sup.contactName ?? ""} · ${sup.phone ?? ""}`} back={{ href: "/proveedores", label: "Proveedores" }} actions={<Link href="/compras/ordenes/nueva" className="btn-primary">Nueva OC</Link>} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Productos ofrecidos" value={String(sup.products.length)} icon={Package} tone="blue" />
        <KpiCard label="Entrega promedio" value={`${sup.averageLeadTime} días`} icon={Truck} tone="green" />
        <KpiCard label="Por pagar" value={money(owed)} icon={Wallet} tone="orange" hint={sup.creditDays ? `Crédito ${sup.creditDays} días` : "Contado"} />
        <KpiCard label="Entregas a tiempo" value={received.length ? `${Math.round((onTime / received.length) * 100)}%` : "—"} icon={Clock} tone="purple" hint={`${received.length} OC recibidas`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Catálogo del proveedor" bodyClassName="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Producto</th><th>Código prov.</th><th className="text-right">Precio</th><th className="text-right">Mín.</th><th className="text-right">Entrega</th></tr></thead>
            <tbody>
              {sup.products.map((p) => (
                <tr key={p.id}><td><Link href={`/inventario/productos/${p.productId}?tab=proveedores`} className="hover:text-brand-600">{p.product.name}</Link>{p.isPreferred && <span className="ml-1 text-xs text-brand-600">★</span>}</td><td className="font-mono text-xs">{p.supplierSku}</td><td className="num text-right">{money(p.price)}</td><td className="num text-right">{p.minimumOrderQuantity}</td><td className="num text-right">{p.leadTimeDays} d</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          <Card title="Órdenes de compra recientes" bodyClassName="overflow-x-auto">
            <table className="table">
              <thead><tr><th>OC</th><th>Fecha</th><th className="text-right">Total</th><th>Estado</th></tr></thead>
              <tbody>{sup.purchaseOrders.map((p) => <tr key={p.id}><td><Link href={`/compras/ordenes/${p.id}`} className="text-brand-600">{p.number}</Link></td><td>{date(p.orderDate)}</td><td className="num text-right">{money(p.total)}</td><td><StatusBadge map={PO_STATUS} value={p.status} /></td></tr>)}</tbody>
            </table>
          </Card>
          <Card title="Cuentas por pagar" bodyClassName="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Documento</th><th>Vence</th><th className="text-right">Valor</th><th /></tr></thead>
              <tbody>
                {payables.map((p) => (
                  <tr key={p.id}>
                    <td className="text-xs">{p.documentNumber}</td>
                    <td className={p.status === "PENDING" && p.dueDate < new Date() ? "font-semibold text-danger" : ""}>{date(p.dueDate)}</td>
                    <td className="num text-right">{money(p.amount)}</td>
                    <td>{p.status === "PAID" ? <span className="text-xs text-success">Pagada</span> : can(s, "finance.pay") ? <ActionButton className="btn-ghost px-2 py-1 text-xs" confirm={`¿Registrar pago de ${money(p.amount - p.paidAmount)}?`} action={payPayableAction.bind(null, p.id)} success="Pago registrado.">Pagar</ActionButton> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
      <div className="mt-4 max-w-4xl">
        <EntityForm fields={supplierFields} sections={supplierSections} initial={{ id: sup.id, ...Object.fromEntries(supplierFields.map((f) => [f.name, (sup as Record<string, unknown>)[f.name] ?? ""])) }} action={saveSupplierAction} submitLabel="Guardar cambios" />
      </div>
    </div>
  );
}

export const metadata = { title: "Proveedor" };
