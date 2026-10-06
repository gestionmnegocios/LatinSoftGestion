"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

type T = { id: number; message: string; kind: "success" | "error" };

export function toast(message: string, kind: "success" | "error" = "success") {
  window.dispatchEvent(new CustomEvent("ls-toast", { detail: { message, kind } }));
}

export function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    const h = (e: Event) => {
      const { message, kind } = (e as CustomEvent).detail;
      const id = Date.now() + Math.random();
      setItems((s) => [...s, { id, message, kind }]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
    };
    window.addEventListener("ls-toast", h);
    return () => window.removeEventListener("ls-toast", h);
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 no-print">
      {items.map((t) => (
        <div key={t.id} role="status" className={clsx("flex items-start gap-2 rounded-xl border bg-white p-3 text-[13px] shadow-lg", t.kind === "error" ? "border-danger/30" : "border-success/30")}>
          {t.kind === "error" ? <AlertTriangle size={18} className="shrink-0 text-danger" /> : <CheckCircle2 size={18} className="shrink-0 text-success" />}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} aria-label="Cerrar"><X size={14} className="text-ink-500" /></button>
        </div>
      ))}
    </div>
  );
}
