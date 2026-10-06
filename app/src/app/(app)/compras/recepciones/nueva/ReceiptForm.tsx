"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScanBarcode, Loader2 } from "lucide-react";
import { toast } from "@/components/Toast";
import { receiveAction } from "@/app/actions";
import { num } from "@/lib/format";

type Item = { id: string; productId: string; name: string; sku: string; barcode: string | null; ordered: number; received: number; unitCost: number; trackLot: boolean; trackExpiration: boolean };
type Line = { receivedQuantity: number; rejectedQuantity: number; unitCost: number; lotNumber: string; expirationDate: string };

export function ReceiptForm({ poId, items }: { poId: string; items: Item[] }) {
  const [lines, setLines] = useState<Record<string, Line>>(() =>
    Object.fromEntries(items.map((i) => [i.id, { receivedQuantity: Math.max(0, i.ordered - i.received), rejectedQuantity: 0, unitCost: i.unitCost, lotNumber: "", expirationDate: "" }])),
  );
  const [notes, setNotes] = useState("");
  const [scan, setScan] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (id: string, patch: Partial<Line>) => setLines((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const needsLot = items.some((i) => i.trackLot || i.trackExpiration);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <ScanBarcode size={18} className="text-ink-500" />
        <input
          className="input max-w-xs"
          placeholder="Escanear código para sumar 1 unidad"
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const it = items.find((i) => i.barcode === scan.trim() || i.sku.toLowerCase() === scan.trim().toLowerCase());
            if (!it) toast(`Código ${scan} no pertenece a esta OC.`, "error");
            else set(it.id, { receivedQuantity: lines[it.id].receivedQuantity + 1 });
            setScan("");
          }}
        />
        <button className="btn-ghost text-xs" onClick={() => setLines((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, receivedQuantity: 0 }])))}>Poner en cero (conteo con lector)</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="table min-w-[1000px]">
          <thead>
            <tr><th>Producto</th><th className="text-right">Pedido</th><th className="text-right">Ya recibido</th><th className="w-24">Recibido</th><th className="w-24">Rechazado</th><th className="text-right">Pendiente</th><th className="w-28">Costo real</th>{needsLot && <th className="w-32">Lote</th>}{needsLot && <th className="w-36">Vencimiento</th>}</tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const l = lines[i.id];
              const accepted = Math.max(0, l.receivedQuantity - l.rejectedQuantity);
              const pendingAfter = i.ordered - i.received - accepted;
              return (
                <tr key={i.id}>
                  <td><div className="font-medium">{i.name}</div><div className="font-mono text-[11px] text-ink-500">{i.sku}</div></td>
                  <td className="num text-right">{num(i.ordered)}</td>
                  <td className="num text-right text-ink-500">{num(i.received)}</td>
                  <td><input type="number" min={0} className="input num py-1.5" value={l.receivedQuantity} onChange={(e) => set(i.id, { receivedQuantity: Math.max(0, Number(e.target.value)) })} /></td>
                  <td><input type="number" min={0} className="input num py-1.5" value={l.rejectedQuantity} onChange={(e) => set(i.id, { rejectedQuantity: Math.max(0, Number(e.target.value)) })} /></td>
                  <td className={`num text-right font-semibold ${pendingAfter < 0 ? "text-danger" : pendingAfter > 0 ? "text-danger" : "text-success"}`}>{pendingAfter < 0 ? `Excede ${-pendingAfter}` : num(pendingAfter)}</td>
                  <td><input type="number" min={0} className="input num py-1.5" value={l.unitCost} onChange={(e) => set(i.id, { unitCost: Number(e.target.value) })} /></td>
                  {needsLot && <td>{i.trackLot ? <input className="input py-1.5" placeholder="L-4587" value={l.lotNumber} onChange={(e) => set(i.id, { lotNumber: e.target.value })} /> : <span className="text-ink-500">—</span>}</td>}
                  {needsLot && <td>{i.trackExpiration ? <input type="date" className="input py-1.5" value={l.expirationDate} onChange={(e) => set(i.id, { expirationDate: e.target.value })} /> : <span className="text-ink-500">—</span>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <label className="block"><span className="label">Observaciones</span><input className="input" placeholder="Mercancía en buen estado" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <button
          className="btn-success self-end px-8 py-2.5"
          disabled={pending}
          onClick={() => {
            if (!confirm("Confirmar recepción: se actualizarán Kardex, inventario, costo promedio, la OC y cuentas por pagar. ¿Continuar?")) return;
            start(async () => {
              const r = await receiveAction(poId, items.map((i) => ({ purchaseOrderItemId: i.id, ...lines[i.id], lotNumber: lines[i.id].lotNumber || undefined, expirationDate: lines[i.id].expirationDate || undefined })), notes);
              if (!r.ok) return toast(r.error, "error");
              toast(`Recepción ${r.data!.number} confirmada. ${r.data!.status === "RECEIVED" ? "OC recibida completa." : "Quedan unidades pendientes."}`);
              router.push(`/compras/ordenes/${poId}`);
            });
          }}
        >
          {pending && <Loader2 size={14} className="animate-spin" />} Confirmar recepción
        </button>
      </div>
    </div>
  );
}
