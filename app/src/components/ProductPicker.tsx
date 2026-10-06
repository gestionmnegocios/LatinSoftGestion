"use client";
import { useMemo, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { num } from "@/lib/format";

type P = { id: string; sku: string; barcode: string | null; name: string; available?: number };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Buscador por nombre, SKU o código de barras. Un lector USB escribe el código + Enter y agrega el producto. */
export function ProductPicker<T extends P>({ products, onPick, placeholder = "Código, nombre o código de barras", buttonLabel = "Agregar" }: {
  products: T[];
  onPick: (p: T) => void;
  placeholder?: string;
  buttonLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return products.slice(0, 8);
    return products.filter((p) => norm(p.name).includes(n) || norm(p.sku).includes(n) || (p.barcode ?? "").includes(n)).slice(0, 8);
  }, [q, products]);

  const pick = (p: T | undefined) => {
    if (!p) return;
    onPick(p);
    setQ("");
    setOpen(false);
    setHi(0);
    ref.current?.focus();
  };

  return (
    <div className="relative flex flex-1 gap-2">
      <div className="relative flex-1">
        <input
          ref={ref}
          className="input pr-9"
          placeholder={placeholder}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            if (e.key === "Enter") {
              e.preventDefault();
              const exact = products.find((p) => p.barcode === q.trim() || norm(p.sku) === norm(q.trim()));
              pick(exact ?? results[hi]);
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <ScanBarcode size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500" />
        {open && results.length > 0 && (
          <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line-200 bg-white py-1 shadow-lg">
            {results.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] ${i === hi ? "bg-brand-50" : "hover:bg-surface-50"}`}
                >
                  <span><span className="mr-2 font-mono text-xs text-ink-500">{p.sku}</span>{p.name}</span>
                  {p.available !== undefined && (
                    <span className={`text-xs font-semibold ${p.available <= 0 ? "text-danger" : "text-ink-500"}`}>Disp. {num(p.available)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="btn-primary" onClick={() => pick(results[hi])}>{buttonLabel}</button>
    </div>
  );
}
