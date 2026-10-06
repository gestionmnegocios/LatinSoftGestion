"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { toast } from "@/components/Toast";
import { removeSupplierProductAction, saveSupplierProductAction } from "@/app/actions";
import { money, date } from "@/lib/format";

type Offer = { id: string; supplierId: string; supplier: string; price: number; supplierSku: string | null; minimumOrderQuantity: number; leadTimeDays: number; discountPct: number; isPreferred: boolean; updatedAt: string };

/** Relación producto ↔ proveedor (N:M): un producto puede tener múltiples proveedores. */
export function SupplierOffers({ productId, suppliers, offers, averageCost, canEdit }: {
  productId: string;
  suppliers: { id: string; name: string; lead: number }[];
  offers: Offer[];
  averageCost: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const empty = { supplierId: suppliers[0]?.id ?? "", price: Math.round(averageCost), supplierSku: "", minimumOrderQuantity: 1, leadTimeDays: suppliers[0]?.lead ?? 3, discountPct: 0, isPreferred: offers.length === 0 };
  const [form, setForm] = useState(empty);
  const best = offers.length ? Math.min(...offers.map((o) => o.price * (1 - o.discountPct / 100))) : 0;

  const save = (data: typeof form) => start(async () => {
    const r = await saveSupplierProductAction({ ...data, productId });
    if (!r.ok) return toast(r.error, "error");
    toast("Oferta de proveedor guardada.");
    setForm(empty);
    router.refresh();
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="card overflow-x-auto">
        <table className="table min-w-[680px]">
          <thead><tr><th>Proveedor</th><th>Código proveedor</th><th className="text-right">Precio</th><th className="text-right">Desc.</th><th className="text-right">Mín. compra</th><th className="text-right">Entrega</th><th>Actualizado</th><th /></tr></thead>
          <tbody>
            {offers.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-ink-500">Este producto no tiene proveedores asociados.</td></tr>}
            {offers.map((o) => (
              <tr key={o.id}>
                <td className="font-medium">{o.supplier} {o.isPreferred && <Badge tone="brand"><Star size={11} /> Preferido</Badge>}</td>
                <td className="font-mono text-xs">{o.supplierSku ?? "—"}</td>
                <td className="num text-right">{money(o.price)} {o.price * (1 - o.discountPct / 100) === best && offers.length > 1 && <Badge tone="success">Mejor</Badge>}</td>
                <td className="num text-right">{o.discountPct ? `${o.discountPct}%` : "—"}</td>
                <td className="num text-right">{o.minimumOrderQuantity}</td>
                <td className="num text-right">{o.leadTimeDays} días</td>
                <td className="text-xs text-ink-500">{date(o.updatedAt)}</td>
                <td className="whitespace-nowrap">
                  {canEdit && <>
                    <button className="mr-2 text-xs font-medium text-brand-600" onClick={() => setForm({ supplierId: o.supplierId, price: o.price, supplierSku: o.supplierSku ?? "", minimumOrderQuantity: o.minimumOrderQuantity, leadTimeDays: o.leadTimeDays, discountPct: o.discountPct, isPreferred: o.isPreferred })}>Editar</button>
                    <button className="text-ink-500 hover:text-danger" aria-label="Quitar" onClick={() => start(async () => { const r = await removeSupplierProductAction(o.id); if (!r.ok) toast(r.error, "error"); else router.refresh(); })}><Trash2 size={14} /></button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <form className="card space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); save(form); }}>
          <h3 className="h3">Agregar / actualizar oferta</h3>
          <label className="block"><span className="label">Proveedor</span>
            <select className="input" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value, leadTimeDays: suppliers.find((s) => s.id === e.target.value)?.lead ?? form.leadTimeDays })}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Precio</span><input type="number" min={1} className="input num" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></label>
            <label className="block"><span className="label">Descuento %</span><input type="number" min={0} max={100} className="input num" value={form.discountPct} onChange={(e) => setForm({ ...form, discountPct: Number(e.target.value) })} /></label>
            <label className="block"><span className="label">Cantidad mínima</span><input type="number" min={1} className="input num" value={form.minimumOrderQuantity} onChange={(e) => setForm({ ...form, minimumOrderQuantity: Number(e.target.value) })} /></label>
            <label className="block"><span className="label">Entrega (días)</span><input type="number" min={0} className="input num" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: Number(e.target.value) })} /></label>
          </div>
          <label className="block"><span className="label">Código del proveedor</span><input className="input" value={form.supplierSku} onChange={(e) => setForm({ ...form, supplierSku: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.isPreferred} onChange={(e) => setForm({ ...form, isPreferred: e.target.checked })} /> Proveedor preferido</label>
          <button className="btn-primary w-full" disabled={pending}>{pending ? "Guardando…" : "Guardar oferta"}</button>
        </form>
      )}
    </div>
  );
}
