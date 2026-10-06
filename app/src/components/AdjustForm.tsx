"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { adjustAction } from "@/app/actions";
import { toast } from "./Toast";

/** Ajuste de inventario: nunca edita la cantidad directamente; registra un movimiento con la diferencia. */
export function AdjustButton({
  productId, productName, warehouses, defaultWarehouseId, balances, label = "Ajustar", className = "btn-ghost",
}: {
  productId: string;
  productName: string;
  warehouses: { id: string; name: string }[];
  defaultWarehouseId: string;
  balances: Record<string, { onHand: number; reserved: number }>;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [wh, setWh] = useState(defaultWarehouseId);
  const current = balances[wh]?.onHand ?? 0;
  const [qty, setQty] = useState<number | "">(current);
  const [reason, setReason] = useState("Conteo físico");
  const [pending, start] = useTransition();
  const router = useRouter();
  const diff = qty === "" ? 0 : qty - current;
  return (
    <>
      <button type="button" className={className} onClick={() => { setQty(balances[wh]?.onHand ?? 0); setOpen(true); }}>
        <SlidersHorizontal size={14} /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <form
            className="card w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (qty === "") return;
              start(async () => {
                const r = await adjustAction({ productId, warehouseId: wh, newQuantity: qty, reason });
                if (!r.ok) return toast(r.error, "error");
                toast(`Ajuste registrado en el Kardex (${diff > 0 ? "+" : ""}${diff}).`);
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <div className="mb-4 flex items-start justify-between">
              <div><h3 className="h3">Ajuste de inventario</h3><p className="text-xs text-ink-500">{productName}</p></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <label className="block"><span className="label">Bodega</span>
                <select className="input" value={wh} onChange={(e) => { setWh(e.target.value); setQty(balances[e.target.value]?.onHand ?? 0); }}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="label">Cantidad actual</span><div className="input num bg-surface-50">{current}</div></div>
                <label className="block"><span className="label">Cantidad nueva (conteo)</span>
                  <input type="number" min={0} step="any" className="input num" value={qty} onChange={(e) => setQty(e.target.value === "" ? "" : Number(e.target.value))} required />
                </label>
              </div>
              <div className={`rounded-lg px-3 py-2 text-[13px] ${diff === 0 ? "bg-surface-100 text-ink-500" : diff > 0 ? "bg-success-bg text-success" : "bg-danger-bg text-danger"}`}>
                Movimiento: <b>{diff > 0 ? "+" : ""}{diff}</b> ({diff >= 0 ? "Ajuste positivo" : "Ajuste negativo"})
                {(balances[wh]?.reserved ?? 0) > 0 && <span className="block text-xs text-ink-500">Comprometido en pedidos: {balances[wh]?.reserved}</span>}
              </div>
              <label className="block"><span className="label">Motivo</span>
                <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {["Conteo físico", "Inventario inicial", "Avería / daño", "Vencimiento", "Pérdida / robo", "Corrección de error", "Muestra / obsequio"].map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
              <button className="btn-primary" disabled={pending || diff === 0}>{pending ? "Registrando…" : "Registrar ajuste"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
