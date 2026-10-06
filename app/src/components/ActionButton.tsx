"use client";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "./Toast";
import type { ActionResult } from "@/app/actions";

/** Botón que ejecuta una server action enlazada, con confirmación, toast y redirección opcional. */
export function ActionButton({
  action, children, className = "btn-primary", confirm, success, redirectTo, disabled,
}: {
  action: () => Promise<ActionResult<any>>;
  children: ReactNode;
  className?: string;
  confirm?: string;
  success?: string;
  /** Usa {data} o {data.campo} para insertar el valor devuelto (p. ej. un id). */
  redirectTo?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending || disabled}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const r = await action();
          if (!r.ok) { toast(r.error, "error"); return; }
          if (success) toast(success);
          if (redirectTo) {
            const d = r.data as any;
            router.push(redirectTo.replace(/\{data(?:\.(\w+))?\}/g, (_, k) => String(k ? d?.[k] ?? "" : d ?? "")));
          }
          else router.refresh();
        });
      }}
    >
      {pending && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export function PrintButton({ children = "Imprimir / PDF" }: { children?: ReactNode }) {
  return <button type="button" className="btn-ghost" onClick={() => window.print()}>{children}</button>;
}
