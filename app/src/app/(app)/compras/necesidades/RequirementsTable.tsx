"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Lightbulb, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { toast } from "@/components/Toast";
import { createRequirementAction } from "@/app/actions";
import { money, num, REASON_LABEL } from "@/lib/format";
import type { RequirementRow } from "@/server/services/procurement";

const TABS = [
  { key: "todos", label: "Todos", test: () => true },
  { key: "bajo", label: "Stock bajo", test: (r: RequirementRow) => r.reason === "LOW_STOCK" },
  { key: "agotados", label: "Agotados", test: (r: RequirementRow) => r.reason === "OUT_OF_STOCK" },
  { key: "pedidos", label: "Por pedidos", test: (r: RequirementRow) => r.shortage > 0 },
  { key: "recomendados", label: "Recomendados", test: (r: RequirementRow) => r.reason === "FORECAST" },
];

export function RequirementsTable({ rows, horizon, warehouseId, initialTab }: { rows: RequirementRow[]; horizon: number; warehouseId: string; initialTab: string }) {
  const [tab, setTab] = useState(initialTab);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(rows.map((r) => [r.productId, r.suggested])));
  const [sel, setSel] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.productId, r.reason !== "FORECAST"])));
  const [pending, start] = useTransition();
  const router = useRouter();
  const visible = rows.filter(TABS.find((t) => t.key === tab)?.test ?? (() => true));
  const chosen = rows.filter((r) => sel[r.productId] && (qty[r.productId] ?? 0) > 0);
  const total = useMemo(() => chosen.reduce((s, r) => s + (qty[r.productId] ?? 0) * r.unitCost, 0), [chosen, qty]);
  const suppliers = new Set(chosen.map((r) => r.preferredSupplier).filter(Boolean));
  const allVisibleSelected = visible.length > 0 && visible.every((r) => sel[r.productId]);

  if (rows.length === 0) {
    return <div className="card flex items-center gap-3 p-6 text-success"><CheckCircle2 /> No hay productos que requieran compra para los próximos {horizon} días.</div>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-line-200 p-3">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={clsx("rounded-lg border px-3 py-1.5 text-[13px] font-medium", tab === t.key ? "border-brand-500 bg-brand-100 text-brand-600" : "border-line-200 bg-white text-ink-700 hover:bg-surface-100")}>
              {t.label} ({rows.filter(t.test).length})
            </button>
          ))}
        </div>
        <div className="max-h-[560px] overflow-auto">
          <table className="table min-w-[900px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="w-8"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={allVisibleSelected} onChange={(e) => setSel((s) => ({ ...s, ...Object.fromEntries(visible.map((r) => [r.productId, e.target.checked])) }))} aria-label="Seleccionar todos" /></th>
                <th className="min-w-[210px]">Producto</th><th className="text-right">Stock</th><th className="text-right">Comprometido</th><th className="text-right">Disponible</th><th className="text-right">Mínimo</th><th className="text-right" title={`Demanda estimada ${horizon} días`}>Demanda {horizon}d</th><th className="text-right">En tránsito</th><th className="text-right">Necesario</th><th className="w-24">Comprar</th><th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.productId} className={sel[r.productId] ? "" : "opacity-60"}>
                  <td><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!sel[r.productId]} onChange={(e) => setSel((s) => ({ ...s, [r.productId]: e.target.checked }))} aria-label={`Seleccionar ${r.name}`} /></td>
                  <td><div className="font-medium">{r.name}</div><div className="text-[11px] text-ink-500">{r.sku} · {r.preferredSupplier ?? "sin proveedor"} · {money(r.unitCost)}</div></td>
                  <td className="num text-right">{num(r.onHand)}</td>
                  <td className="num text-right">{num(r.reserved)}{r.shortage > 0 && <div className="text-[11px] font-semibold text-danger">+{num(r.shortage)} faltante</div>}</td>
                  <td className={`num text-right font-semibold ${r.available <= 0 ? "text-danger" : ""}`}>{num(r.available)}</td>
                  <td className="num text-right">{num(r.minimumStock)}</td>
                  <td className="num text-right" title={`${r.avgDailySales}/día`}>{num(r.expectedDemand)}</td>
                  <td className="num text-right">{r.incoming ? num(r.incoming) : "—"}</td>
                  <td className="num text-right">{num(r.needed)}</td>
                  <td><input type="number" min={0} className="input num py-1.5 text-right" value={qty[r.productId] ?? 0} onChange={(e) => setQty((s) => ({ ...s, [r.productId]: Math.max(0, Number(e.target.value)) }))} /></td>
                  <td><Badge tone={r.reason === "OUT_OF_STOCK" || r.reason === "SALES_ORDER" ? "danger" : r.reason === "LOW_STOCK" ? "warning" : "ai"}>{REASON_LABEL[r.reason]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card h-fit border-ai/20 bg-gradient-to-b from-ai-bg/70 to-white p-5">
        <div className="flex items-center gap-2 font-semibold text-navy-900"><Lightbulb size={18} className="text-ai" /> Recomendación IA</div>
        <p className="mt-2 text-[13px] text-ink-700">Basado en ventas de los últimos 90 días, pedidos comprometidos, stock mínimo y de seguridad, se recomienda comprar <b>{chosen.length} productos</b> por un valor estimado de:</p>
        <div className="num mt-2 text-[28px] font-bold text-ai">{money(total)}</div>
        <ul className="mt-3 space-y-2 text-[13px] text-ink-700">
          <li className="flex gap-2"><CheckCircle2 size={16} className="shrink-0 text-success" /> Cubre los próximos {horizon} días</li>
          <li className="flex gap-2"><CheckCircle2 size={16} className="shrink-0 text-success" /> Incluye {num(rows.reduce((s, r) => s + r.shortage, 0))} unidades faltantes de pedidos</li>
          <li className="flex gap-2"><CheckCircle2 size={16} className="shrink-0 text-success" /> Considera stock de seguridad y lo que ya está en tránsito</li>
          <li className="flex gap-2"><CheckCircle2 size={16} className="shrink-0 text-success" /> {suppliers.size} proveedor(es) preferido(s); el comparador evaluará alternativas</li>
        </ul>
        <p className="mt-3 text-[11px] text-ink-500">Puede modificar las cantidades. Ninguna orden se emite sin su aprobación.</p>
        <button
          className="btn-primary mt-4 w-full"
          disabled={pending || chosen.length === 0}
          onClick={() => start(async () => {
            const r = await createRequirementAction(warehouseId, chosen.map((c) => ({ productId: c.productId, quantity: qty[c.productId] })), horizon);
            if (!r.ok) return toast(r.error, "error");
            toast("Necesidad creada. Comparando proveedores…");
            router.push(`/compras/comparador/${r.data}`);
          })}
        >
          {pending && <Loader2 size={14} className="animate-spin" />} Buscar proveedores
        </button>
      </div>
    </div>
  );
}
