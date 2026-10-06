"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { toast } from "@/components/Toast";
import { cashMovementAction, closeCashAction } from "@/app/actions";
import { money } from "@/lib/format";

export function CashForms({ expected }: { expected: number }) {
  const [type, setType] = useState<"IN" | "OUT">("OUT");
  const [amount, setAmount] = useState<number | "">("");
  const [concept, setConcept] = useState("");
  const [counted, setCounted] = useState<number | "">(Math.round(expected));
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Card title="Registrar movimiento">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => {
          const r = await cashMovementAction(type, Number(amount), concept);
          if (!r.ok) return toast(r.error, "error");
          toast("Movimiento registrado."); setAmount(""); setConcept(""); router.refresh();
        }); }}>
          <div className="grid grid-cols-2 gap-2">
            {(["IN", "OUT"] as const).map((t) => <button type="button" key={t} onClick={() => setType(t)} className={`rounded-lg border px-3 py-2 text-[13px] font-medium ${type === t ? (t === "IN" ? "border-success bg-success-bg text-success" : "border-danger bg-danger-bg text-danger") : "border-line-200"}`}>{t === "IN" ? "Ingreso" : "Egreso"}</button>)}
          </div>
          <input type="number" min={1} className="input num" placeholder="Valor" value={amount} onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))} required />
          <input className="input" placeholder="Concepto (ej: pago de servicios)" value={concept} onChange={(e) => setConcept(e.target.value)} required />
          <button className="btn-primary w-full" disabled={pending}>Registrar</button>
        </form>
      </Card>
      <Card title="Cierre de caja">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => {
          const r = await closeCashAction(Number(counted));
          if (!r.ok) return toast(r.error, "error");
          toast("Cierre registrado."); router.refresh();
        }); }}>
          <div className="flex justify-between text-[13px]"><span className="text-ink-500">Saldo esperado</span><b className="num">{money(expected)}</b></div>
          <label className="block"><span className="label">Efectivo contado</span><input type="number" min={0} className="input num" value={counted} onChange={(e) => setCounted(e.target.value === "" ? "" : Number(e.target.value))} required /></label>
          {counted !== "" && <div className={`text-[13px] ${Number(counted) - expected === 0 ? "text-success" : "text-danger"}`}>Diferencia: {money(Number(counted) - expected)}</div>}
          <button className="btn-outline w-full" disabled={pending}>Cerrar caja</button>
        </form>
      </Card>
    </>
  );
}
