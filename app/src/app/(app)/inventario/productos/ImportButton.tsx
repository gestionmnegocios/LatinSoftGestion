"use client";
import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { importProductsAction } from "@/app/actions";
import { toast } from "@/components/Toast";

/** Importa productos desde CSV (mismo formato que Exportar). Crea o actualiza por SKU. */
export function ImportButton() {
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          start(async () => {
            const text = await file.text();
            const r = await importProductsAction(text);
            if (!r.ok) toast(r.error, "error");
            else {
              const d = r.data!;
              toast(`Importación: ${d.created} creados, ${d.updated} actualizados${d.errors.length ? `, ${d.errors.length} con error (${d.errors.slice(0, 2).join("; ")})` : ""}.`, d.errors.length ? "error" : "success");
              router.refresh();
            }
            if (ref.current) ref.current.value = "";
          });
        }}
      />
      <button type="button" className="btn-outline" disabled={pending} onClick={() => ref.current?.click()}>
        <Upload size={15} /> {pending ? "Importando…" : "Importar"}
      </button>
    </>
  );
}
