"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ProductPicker } from "@/components/ProductPicker";
import { toast } from "@/components/Toast";
import { createPurchaseOrderAction } from "@/app/actions";
import { money, num } from "@/lib/format";
import type { ProductOption } from "@/server/queries";

export function POForm({ suppliers, products, offers, warehouseId }: {
  suppliers: { id: string; name: string; shipping: number }[];
  products: ProductOption[];
  offers: { supplierId: string; productId: string; price: number }[];
  warehouseId: string;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [onlyTheirs, setOnlyTheirs] = useState(true);
  const [items, setItems] = useState<{ p: ProductOption; quantity: number; unitCost: number }[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const offerFor = (productId: string) => offers.find((o) => o.supplierId === supplierId && o.productId === productId)?.price;
  const list = onlyTheirs ? products.filter((p) => offerFor(p.id) !== undefined) : products;
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
  const tax = items.reduce((s, i) => s + i.quantity * i.unitCost * (i.p.taxRate / 100), 0);
  const shipping = suppliers.find((s) => s.id === supplierId)?.shipping ?? 0;

  return (
    <div className="space-y-4">
      <div className="card grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
        <label className="block"><span className="label">Proveedor</span>
          <select className="input" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setItems([]); }}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pt-5 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyTheirs} onChange={(e) => setOnlyTheirs(e.target.checked)} /> Solo productos de este proveedor</label>
        <div className="sm:col-span-2"><ProductPicker products={list} onPick={(p) => setItems((s) => (s.some((x) => x.p.id === p.id) ? s : [...s, { p, quantity: Math.max(1, p.minimumStock - p.available), unitCost: offerFor(p.id) ?? p.averageCost }]))} /></div>
      </div>
      <div className="card overflow-x-auto">
        <table className="table min-w-[640px]">
          <thead><tr><th>Producto</th><th className="text-right">Disponible</th><th className="w-28">Cantidad</th><th className="w-32">Costo unit.</th><th className="text-right">Subtotal</th><th /></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-ink-500">Agregue productos.</td></tr>}
            {items.map((it, i) => (
              <tr key={it.p.id}>
                <td>{it.p.name}</td>
                <td className="num text-right">{num(it.p.available)}</td>
                <td><input type="number" min={1} className="input num py-1.5" value={it.quantity} onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} /></td>
                <td><input type="number" min={0} className="input num py-1.5" value={it.unitCost} onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, unitCost: Number(e.target.value) } : x)))} /></td>
                <td className="num text-right">{money(it.quantity * it.unitCost)}</td>
                <td><button onClick={() => setItems((s) => s.filter((_, j) => j !== i))} className="text-ink-500 hover:text-danger" aria-label="Quitar"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <input className="input h-fit" placeholder="Observaciones" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="card p-4 text-[13px]">
          <div className="flex justify-between py-1"><span className="text-ink-500">Subtotal</span><span className="num">{money(subtotal)}</span></div>
          <div className="flex justify-between py-1"><span className="text-ink-500">IVA</span><span className="num">{money(tax)}</span></div>
          <div className="flex justify-between py-1"><span className="text-ink-500">Transporte</span><span className="num">{money(shipping)}</span></div>
          <div className="flex justify-between border-t border-line-200 pt-2 text-[16px] font-bold"><span>Total</span><span className="num">{money(subtotal + tax + shipping)}</span></div>
          <button className="btn-primary mt-3 w-full" disabled={pending || !items.length} onClick={() => start(async () => {
            const r = await createPurchaseOrderAction({ supplierId, warehouseId, notes, items: items.map((i) => ({ productId: i.p.id, quantity: i.quantity, unitCost: i.unitCost })) });
            if (!r.ok) return toast(r.error, "error");
            toast("OC creada en borrador.");
            router.push(`/compras/ordenes/${r.data}`);
          })}>{pending ? "Creando…" : "Crear OC en borrador"}</button>
        </div>
      </div>
    </div>
  );
}
