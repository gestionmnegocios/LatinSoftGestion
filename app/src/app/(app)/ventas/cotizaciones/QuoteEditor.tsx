"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Trash2, CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { ProductPicker } from "@/components/ProductPicker";
import { Badge } from "@/components/ui";
import { toast } from "@/components/Toast";
import { saveQuoteAction, convertQuoteAction } from "@/app/actions";
import { money, num } from "@/lib/format";
import type { ProductOption } from "@/server/queries";

type Line = { productId: string; quantity: number; unitPrice: number; discountPct: number };

export function QuoteEditor({
  customers, priceLists, products, warehouseId, warehouseName, initial, number, salesperson,
}: {
  customers: { id: string; name: string; documentNumber: string; priceListId: string | null }[];
  priceLists: { id: string; name: string; isDefault: boolean }[];
  products: ProductOption[];
  warehouseId: string;
  warehouseName: string;
  initial?: { id?: string; customerId: string; priceListId: string | null; notes: string | null; validityDays: number; items: Line[]; status: string };
  number: string;
  salesperson: string;
}) {
  const router = useRouter();
  const defaultList = priceLists.find((p) => p.isDefault)?.id ?? priceLists[0]?.id ?? "";
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [priceListId, setPriceListId] = useState(initial?.priceListId ?? defaultList);
  const [lines, setLines] = useState<Line[]>(initial?.items ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [validityDays, setValidityDays] = useState(initial?.validityDays ?? 15);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const priceFor = (p: ProductOption, list = priceListId) => p.prices[list] ?? p.salePrice;

  const onCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c?.priceListId && c.priceListId !== priceListId) changeList(c.priceListId);
  };
  const changeList = (list: string) => {
    setPriceListId(list);
    setLines((ls) => ls.map((l) => ({ ...l, unitPrice: priceFor(byId.get(l.productId)!, list) })));
  };
  const add = (p: ProductOption) => {
    setLines((ls) => {
      const existing = ls.find((l) => l.productId === p.id);
      if (existing) return ls.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { productId: p.id, quantity: 1, unitPrice: priceFor(p), discountPct: 0 }];
    });
  };
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const calc = lines.map((l) => {
    const p = byId.get(l.productId)!;
    const gross = l.quantity * l.unitPrice;
    const disc = gross * (l.discountPct / 100);
    const subtotal = gross - disc;
    const tax = subtotal * (p.taxRate / 100);
    const missing = Math.max(0, l.quantity - Math.max(0, p.available));
    return { ...l, p, gross, disc, subtotal, tax, missing };
  });
  const subtotal = calc.reduce((s, c) => s + c.gross, 0);
  const discount = calc.reduce((s, c) => s + c.disc, 0);
  const tax = calc.reduce((s, c) => s + c.tax, 0);
  const total = subtotal - discount + tax;
  const shortages = calc.filter((c) => c.missing > 0);
  const taxRates = [...new Set(calc.map((c) => c.p.taxRate))];

  const payload = () => ({ id: initial?.id, customerId, priceListId, warehouseId, validityDays, notes, items: lines });

  const save = (status: "DRAFT" | "SENT", then?: "convert") => {
    setBusy(then ?? status);
    start(async () => {
      const r = await saveQuoteAction(payload(), status);
      if (!r.ok) { toast(r.error, "error"); setBusy(null); return; }
      const id = r.data as string;
      if (then === "convert") {
        const c = await convertQuoteAction(id);
        if (!c.ok) { toast(c.error, "error"); setBusy(null); router.push(`/ventas/cotizaciones/${id}`); return; }
        const d = c.data!;
        toast(d.shortages.length ? `Pedido ${d.number} creado con faltantes: ${d.shortages.join("; ")}` : `Pedido ${d.number} creado y reservado.`, d.shortages.length ? "error" : "success");
        router.push(`/ventas/pedidos/${d.orderId}`);
        return;
      }
      toast(status === "SENT" ? "Cotización guardada y marcada como enviada." : "Borrador guardado.");
      router.push(`/ventas/cotizaciones/${id}`);
    });
  };

  const step = !customerId ? 1 : lines.length === 0 ? 2 : 3;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-6 text-[13px]">
        {["Cliente", "Productos", "Resumen"].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className={clsx("flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold", i + 1 <= step ? "bg-brand-600 text-white" : "bg-surface-100 text-ink-500")}>{i + 1}</span>
            <span className={clsx(i + 1 <= step ? "font-semibold text-ink-950" : "text-ink-500")}>{label}</span>
            {i < 2 && <span className="ml-4 hidden h-px w-16 bg-line-200 sm:block" />}
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_1fr]">
          <label className="block">
            <span className="label">Cliente</span>
            <select className="input" value={customerId} onChange={(e) => onCustomer(e.target.value)}>
              <option value="">Seleccione un cliente…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.documentNumber}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Lista de precios</span>
            <select className="input" value={priceListId} onChange={(e) => changeList(e.target.value)}>
              {priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="rounded-lg border border-line-200 bg-surface-50 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-bold">{number}</span>
              <Badge tone={initial?.status === "SENT" ? "info" : "warning"}>{initial?.status === "SENT" ? "Enviada" : "Borrador"}</Badge>
            </div>
            <div className="mt-0.5 text-xs text-ink-500">Vendedor: {salesperson} · Bodega: {warehouseName}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <span className="label sm:mb-2.5 sm:w-28">Buscar producto…</span>
          <ProductPicker products={products} onPick={add} />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table min-w-[860px]">
          <thead>
            <tr><th className="w-8">#</th><th>Producto</th><th className="w-24">Cantidad</th><th className="w-32">Precio</th><th className="w-20">Desc. %</th><th className="text-right">Subtotal</th><th className="text-right">Stock</th><th>Disponibilidad</th><th className="w-8" /></tr>
          </thead>
          <tbody>
            {calc.length === 0 && (
              <tr><td colSpan={9} className="py-10 text-center text-ink-500">Busque productos por nombre, SKU o escanee el código de barras.</td></tr>
            )}
            {calc.map((c, i) => (
              <tr key={c.productId}>
                <td>{i + 1}</td>
                <td><div className="font-medium">{c.p.name}</div><div className="font-mono text-[11px] text-ink-500">{c.p.sku}</div></td>
                <td><input type="number" min={1} className="input num py-1.5 text-right" value={c.quantity} onChange={(e) => update(i, { quantity: Math.max(0, Number(e.target.value)) })} /></td>
                <td><input type="number" min={0} step={100} className="input num py-1.5 text-right" value={c.unitPrice} onChange={(e) => update(i, { unitPrice: Math.max(0, Number(e.target.value)) })} /></td>
                <td><input type="number" min={0} max={100} className="input num py-1.5 text-right" value={c.discountPct} onChange={(e) => update(i, { discountPct: Math.min(100, Math.max(0, Number(e.target.value))) })} /></td>
                <td className="num text-right font-medium">{money(c.subtotal)}</td>
                <td className="num text-right" title={`Físico ${c.p.onHand} · Comprometido ${c.p.reserved}`}>{num(c.p.available)}</td>
                <td>
                  {c.p.available <= 0 ? <Badge tone="danger"><XCircle size={12} /> Agotado · faltan {num(c.missing)}</Badge>
                    : c.missing > 0 ? <Badge tone="warning"><AlertTriangle size={12} /> Parcial · faltan {num(c.missing)}</Badge>
                    : c.p.available - c.quantity <= c.p.minimumStock ? <Badge tone="warning"><CheckCircle2 size={12} /> Stock bajo</Badge>
                    : <Badge tone="success"><CheckCircle2 size={12} /> Disponible</Badge>}
                </td>
                <td><button className="text-ink-500 hover:text-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Quitar"><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          {shortages.length > 0 && (
            <div className="rounded-xl border border-danger/25 bg-danger-bg p-4">
              <div className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle size={18} /> Faltantes detectados</div>
              <ul className="mt-2 space-y-1 text-[13px] text-ink-700">
                {shortages.map((s) => <li key={s.productId}>• {s.p.name}: solicitado {num(s.quantity)}, disponible {num(Math.max(0, s.p.available))}, <b>faltan {num(s.missing)} unidades</b>.</li>)}
              </ul>
              <p className="mt-2 text-xs text-ink-500">Al convertir en pedido se reserva lo disponible y el faltante se envía al motor de abastecimiento.</p>
            </div>
          )}
          <div className="card grid gap-3 p-4 sm:grid-cols-[140px_1fr]">
            <label className="block">
              <span className="label">Validez (días)</span>
              <input type="number" min={1} className="input" value={validityDays} onChange={(e) => setValidityDays(Math.max(1, Number(e.target.value)))} />
            </label>
            <label className="block">
              <span className="label">Observaciones</span>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condiciones, entrega, forma de pago…" />
            </label>
          </div>
        </div>
        <div className="card p-4">
          <div className="mb-2 font-semibold">Totales</div>
          <div className="flex justify-between py-1 text-[13px]"><span className="text-ink-500">Subtotal</span><span className="num">{money(subtotal)}</span></div>
          {discount > 0 && <div className="flex justify-between py-1 text-[13px]"><span className="text-ink-500">Descuento</span><span className="num">-{money(discount)}</span></div>}
          <div className="flex justify-between py-1 text-[13px]"><span className="text-ink-500">IVA {taxRates.length === 1 ? `(${taxRates[0]}%)` : ""}</span><span className="num">{money(tax)}</span></div>
          <div className="mt-1 flex justify-between border-t border-line-200 pt-2 text-[17px] font-bold"><span>Total</span><span className="num">{money(total)}</span></div>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-line-200 pt-4">
        <button className="btn-outline" disabled={pending} onClick={() => save("DRAFT")}>{busy === "DRAFT" && <Loader2 size={14} className="animate-spin" />}Guardar borrador</button>
        <button className="btn-primary" disabled={pending} onClick={() => save("SENT")}>{busy === "SENT" && <Loader2 size={14} className="animate-spin" />}Enviar cotización</button>
        <button className="btn-success" disabled={pending} onClick={() => save("SENT", "convert")}>{busy === "convert" && <Loader2 size={14} className="animate-spin" />}Convertir en pedido</button>
      </div>
    </div>
  );
}
