"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { toast } from "@/components/Toast";
import { createUserAction, setUserRoleAction, toggleUserAction } from "@/app/actions";
import { dateTime } from "@/lib/format";

type U = { id: string; name: string; email: string; status: string; roleId: string; lastLoginAt: string | null };

export function UsersAdmin({ users, roles, canManage, currentUserId }: { users: U[]; roles: { id: string; name: string }[]; canManage: boolean; currentUserId: string }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", roleId: roles[0]?.id ?? "" });
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast(r.error!, "error");
    toast(msg); router.refresh();
  });
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="card overflow-x-auto">
        <table className="table min-w-[700px]">
          <thead><tr><th>Usuario</th><th>Rol</th><th>Último ingreso</th><th>Estado</th>{canManage && <th />}</tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><div className="font-medium">{u.name}</div><div className="text-xs text-ink-500">{u.email}</div></td>
                <td>
                  {canManage && u.id !== currentUserId ? (
                    <select className="input py-1.5" value={u.roleId} disabled={pending} onChange={(e) => run(() => setUserRoleAction(u.id, e.target.value), "Rol actualizado.")}>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  ) : roles.find((r) => r.id === u.roleId)?.name}
                </td>
                <td className="text-xs text-ink-500">{u.lastLoginAt ? dateTime(u.lastLoginAt) : "Nunca"}</td>
                <td>{u.status === "ACTIVE" ? <Badge tone="success">Activo</Badge> : <Badge tone="danger">Inactivo</Badge>}</td>
                {canManage && <td>{u.id !== currentUserId && <button className="text-xs font-medium text-brand-600" disabled={pending} onClick={() => run(() => toggleUserAction(u.id), "Estado actualizado.")}>{u.status === "ACTIVE" ? "Desactivar" : "Activar"}</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && (
        <Card title="Nuevo usuario">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await createUserAction(form); if (r.ok) setForm({ ...form, name: "", email: "", password: "" }); return r; }, "Usuario creado."); }}>
            <input className="input" placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <input className="input" type="password" placeholder="Contraseña (mín. 8)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} autoComplete="new-password" />
            <select className="input" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            <button className="btn-primary w-full" disabled={pending}>Crear usuario</button>
          </form>
        </Card>
      )}
    </div>
  );
}
