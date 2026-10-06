"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Star, Sparkles, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { toast } from "@/components/Toast";
import { ordersFromComparisonAction } from "@/app/actions";
import { money, num } from "@/lib/format";
import type { Comparison } from "@/server/services/procurement";

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-warning">
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={12} fill={i <= Math.round(value) ? "currentColor" : "none"} />)}
      <span className="ml-1 text-xs text-ink-500">({value.toFixed(1)})</span>
    </span>
  );
}

export function Comparator({ cmp, open, weights }: { cmp: Comparison; open: boolean; weights: Record<string, number> }) {
  const [detail, setDetail] = useState(false);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState("");
  const router = useRouter();
  const choose = (choice: string) => {
    setBusy(choice);
    start(async () => {
      const r = await ordersFromComparisonAction(cmp.requirement.id, choice);
      if (!r.ok) { setBusy(""); return toast(r.error, "error"); }
      const ids = r.data as string[];
      toast(ids.length > 1 ? `${ids.length} órdenes de compra creadas en borrador.` : "Orden de compra creada en borrador.");
      router.push(ids.length === 1 ? `/compras/ordenes/${ids[0]}` : "/compras/ordenes");
    });
  };
  const full = cmp.options.filter((o) => o.coverage >= 0.999).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3 text-[13px]">
        <span className="text-ink-500">{full} de {cmp.options.length} proveedores pueden suministrar todos los productos</span>
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={detail} onChange={(e) => setDetail(e.target.checked)} /> Ver comparación detallada
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-[220px_1fr_300px]">
        <div className="card h-fit p-4">
          <div className="mb-3 font-semibold">Productos a comprar</div>
          <ul className="space-y-2 text-[13px]">
            {cmp.items.map((i) => <li key={i.productId} className="flex gap-2"><b className="num w-8 text-right">{num(i.quantity)}</b><span>{i.name}</span></li>)}
          </ul>
          <div className="mt-4 border-t border-line-200 pt-3 text-[11px] text-ink-500">
            Puntaje: precio {weights.price * 100}% · entrega {weights.delivery * 100}% · cumplimiento {weights.fulfillment * 100}% · crédito {weights.credit * 100}% · disponibilidad {weights.availability * 100}%
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {cmp.options.map((o) => {
            const rec = o.supplierId === cmp.recommendedId && cmp.optimized?.reason !== "coverage";
            return (
              <div key={o.supplierId} className={clsx("card relative flex flex-col p-4", rec && "border-2 border-accent-600 pt-6 shadow-md")}>
                {rec && <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-600 px-3 py-0.5 text-[11px] font-semibold text-white">Recomendado por IA</div>}
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">{o.name}</div>
                  <Badge tone={o.coverage >= 0.999 ? "success" : "warning"}>Cobertura {Math.round(o.coverage * 100)}%</Badge>
                </div>
                <div className="mt-3 text-xs text-ink-500">Total estimado (antes de IVA)</div>
                <div className="num text-[22px] font-bold">{money(o.total)}</div>
                <dl className="mt-3 space-y-1.5 text-[13px]">
                  <div className="flex justify-between"><dt className="text-ink-500">Entrega</dt><dd>{o.leadTime} día{o.leadTime === 1 ? "" : "s"}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">Pago</dt><dd>{o.creditDays ? `${o.creditDays} días` : "Contado"}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">Transporte</dt><dd className="num">{o.shipping ? money(o.shipping) : "Incluido"}</dd></div>
                  {o.discountTotal > 0 && <div className="flex justify-between"><dt className="text-ink-500">Descuento</dt><dd className="num">-{money(o.discountTotal)}</dd></div>}
                  <div className="flex justify-between"><dt className="text-ink-500">Calificación</dt><dd><Stars value={o.rating} /></dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">Puntaje</dt><dd className="font-semibold">{o.score}</dd></div>
                </dl>
                {o.missing.length > 0 && <div className="mt-2 rounded-md bg-warning-bg px-2 py-1.5 text-[11px] text-warning-ink">No cubre: {o.missing.join(", ")}</div>}
                {detail && (
                  <table className="mt-3 w-full text-[11px]">
                    <tbody>
                      {o.lines.map((l) => <tr key={l.productId} className="border-t border-line-200"><td className="py-1">{l.name}</td><td className="num py-1 text-right">{num(l.quantity)} × {money(l.unitPrice)}</td></tr>)}
                    </tbody>
                  </table>
                )}
                <div className="mt-auto pt-4">
                  <button className={rec ? "btn-primary w-full" : "btn-outline w-full"} disabled={!open || pending} onClick={() => choose(o.supplierId)}>
                    {busy === o.supplierId && <Loader2 size={14} className="animate-spin" />} Seleccionar
                  </button>
                </div>
              </div>
            );
          })}
          {cmp.options.length === 0 && <div className="card p-6 text-ink-500">Ningún proveedor registrado ofrece estos productos. Asócielos desde la ficha del producto → Proveedores.</div>}
        </div>

        <div className="card h-fit border-ai/25 bg-ai-bg/50 p-4">
          <div className="flex items-center gap-2 font-semibold text-ai"><Sparkles size={16} /> Conclusión de la IA</div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-700">{cmp.explanation}</p>
          {cmp.optimized && (
            <div className="mt-4 rounded-lg border border-success/30 bg-success-bg/70 p-3">
              <div className="text-[13px] font-semibold text-success">{cmp.optimized.reason === "coverage" ? "Compra combinada recomendada" : "También se puede optimizar"}</div>
              <p className="mt-1 text-[12px] text-ink-700">{cmp.optimized.explanation}</p>
              <ul className="mt-2 space-y-1 text-[12px]">
                {cmp.optimized.groups.map((g) => <li key={g.supplierId}><b>{g.name}</b>: {g.lines.map((l) => l.name).join(", ")} — {money(g.total)}</li>)}
              </ul>
              <div className="num mt-2 text-[13px] font-semibold">Total: {money(cmp.optimized.total)}{cmp.optimized.savings > 0 && ` (ahorro ${money(cmp.optimized.savings)})`}</div>
              <button className="btn-success mt-3 w-full" disabled={!open || pending} onClick={() => choose("optimized")}>
                {busy === "optimized" && <Loader2 size={14} className="animate-spin" />} {cmp.optimized.reason === "coverage" ? `Generar ${cmp.optimized.groups.length} órdenes de compra` : "Usar propuesta optimizada"}
              </button>
            </div>
          )}
          <p className="mt-3 text-[11px] text-ink-500">La decisión final es suya: se crean órdenes en borrador que debe revisar y enviar.</p>
        </div>
      </div>
    </div>
  );
}
