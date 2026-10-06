"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { paymentAction } from "@/app/actions";
import { toast } from "@/components/Toast";

export function PaymentForm({ invoiceId, balance }: { invoiceId: string; balance: number }) {
  const [amount, setAmount] = useState(Math.round(balance));
  const [method, setMethod] = useState("Transferencia");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await paymentAction(invoiceId, amount, method);
          if (!r.ok) return toast(r.error, "error");
          toast("Pago registrado e ingresado a caja.");
          router.refresh();
        });
      }}
    >
      <label className="block"><span className="label">Valor</span><input type="number" min={1} className="input num" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
      <label className="block"><span className="label">Medio de pago</span>
        <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
          {["Efectivo", "Transferencia", "Tarjeta", "Consignación"].map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <button className="btn-success w-full" disabled={pending}>{pending ? "Registrando…" : "Registrar pago"}</button>
    </form>
  );
}
