"use client";
import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">Email</span>
        <input name="email" type="email" required defaultValue="admin@latinsoft.co" className="input" autoComplete="username" />
      </label>
      <label className="block">
        <span className="label">Contraseña</span>
        <input name="password" type="password" required className="input" autoComplete="current-password" />
      </label>
      {state?.error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-danger">{state.error}</p>}
      <button className="btn-primary w-full py-2.5" disabled={pending}>{pending ? "Ingresando…" : "Ingresar"}</button>
    </form>
  );
}
