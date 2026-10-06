"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ProductPicker } from "@/components/ProductPicker";
import { toast } from "@/components/Toast";
import { transferAction } from "@/app/actions";
import type { ProductOption } from "@/server/queries";

export function TransferForm({ warehouses, fromId, products }: { warehouses: { id: string; name: string }[]; fromId: string; products: ProductOption[] }) {
  const [from] = useState(fromId);
  const [to, setTo] = useState(warehouses.find((w) => w.id !== fromId)?.id ?? "");
  const [items, setItems] = useState<{ p: ProductOption; quantity: number }[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Origen (bodega actual)</span><div className="input bg-surface-50">{warehouses.find((w) => w.id === from)?.name}</div></label>
        <label className="block"><span className="label">Destino</span>
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>{warehouses.filter((w) => w.id !== from).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        </label>
      </div>
      <ProductPicker products={products.filter((p) => p.available > 0)} onPick={(p) => setItems((s) => (s.some((x) => x.p.id === p.id) ? s : [...s, { p, quantity: 1 }]))} />
      <table className="table">
        <thead><tr><th>Producto</th><th className="text-right">Disponible</th><th className="w-28">Cantidad</th><th /></tr></thead>
        <tbody>
          {items.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-ink-500">Agregue productos con disponibilidad.</td></tr>}
          {items.map((it, i) => (
            <tr key={it.p.id}>
              <td>{it.p.name}</td>
              <td className="num text-right">{it.p.available}</td>
              <td><input type="number" min={1} max={it.p.available} className="input num py-1.5" value={it.quantity} onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} /></td>
              <td><button onClick={() => setItems((s) => s.filter((_, j) => j !== i))} className="text-ink-500 hover:text-danger" aria-label="Quitar"><Trash2 size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <input className="input" placeholder="Observaciones" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex justify-end">
        <button className="btn-primary" disabled={pending || !items.length || !to} onClick={() => start(async () => {
          const r = await transferAction({ fromWarehouseId: from, toWarehouseId: to, items: items.map((i) => ({ productId: i.p.id, quantity: i.quantity })), notes });
          if (!r.ok) return toast(r.error, "error");
          toast(`Transferencia ${r.data} registrada.`);
          setItems([]); setNotes("");
          router.refresh();
        })}>{pending ? "Transfiriendo…" : "Confirmar transferencia"}</button>
      </div>
    </div>
  );
}
