"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { toast } from "./Toast";
import type { ActionResult } from "@/app/actions";

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "number" | "email" | "select" | "checkbox" | "textarea";
  options?: { value: string; label: string }[];
  required?: boolean;
  span?: 1 | 2 | 3;
  step?: number;
  help?: string;
  placeholder?: string;
};

/** Formulario genérico: valida en el backend (Zod) y muestra el error en un toast. */
export function EntityForm({
  fields, initial, action, redirectTo, submitLabel = "Guardar", cancelHref, sections,
}: {
  fields: FieldDef[];
  initial: Record<string, unknown>;
  action: (data: Record<string, unknown>) => Promise<ActionResult<any>>;
  redirectTo?: string;
  submitLabel?: string;
  cancelHref?: string;
  sections?: { title: string; fields: string[] }[];
}) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));
  const groups = sections ?? [{ title: "", fields: fields.map((f) => f.name) }];

  const render = (f: FieldDef) => {
    const v = values[f.name];
    const common = { id: f.name, name: f.name, required: f.required };
    return (
      <label key={f.name} className={clsx("block", f.span === 2 && "sm:col-span-2", f.span === 3 && "sm:col-span-3", f.type === "checkbox" && "flex items-center gap-2 pt-5")}>
        {f.type === "checkbox" ? (
          <>
            <input type="checkbox" {...common} checked={!!v} onChange={(e) => set(f.name, e.target.checked)} className="h-4 w-4 accent-brand-600" />
            <span className="text-[13px] text-ink-700">{f.label}</span>
          </>
        ) : (
          <>
            <span className="label">{f.label}{f.required && <span className="text-danger"> *</span>}</span>
            {f.type === "select" ? (
              <select {...common} className="input" value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)}>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === "textarea" ? (
              <textarea {...common} className="input min-h-20" value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} />
            ) : (
              <input {...common} type={f.type ?? "text"} step={f.step ?? (f.type === "number" ? "any" : undefined)} className={clsx("input", f.type === "number" && "num")} value={String(v ?? "")} placeholder={f.placeholder}
                onChange={(e) => set(f.name, f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} />
            )}
            {f.help && <span className="mt-1 block text-[11px] text-ink-500">{f.help}</span>}
          </>
        )}
      </label>
    );
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await action(values);
          if (!r.ok) return toast(r.error, "error");
          toast("Guardado correctamente.");
          if (redirectTo) router.push(redirectTo.replace("{data}", String(r.data ?? "")));
          else router.refresh();
        });
      }}
    >
      {groups.map((g) => (
        <div key={g.title} className="card p-5">
          {g.title && <h2 className="h3 mb-4">{g.title}</h2>}
          <div className="grid gap-4 sm:grid-cols-3">{g.fields.map((n) => fields.find((f) => f.name === n)).filter(Boolean).map((f) => render(f!))}</div>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        {cancelHref && <button type="button" className="btn-ghost" onClick={() => router.push(cancelHref)}>Cancelar</button>}
        <button className="btn-primary" disabled={pending}>{pending ? "Guardando…" : submitLabel}</button>
      </div>
    </form>
  );
}
