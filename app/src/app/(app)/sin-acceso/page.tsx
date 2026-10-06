import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireSession } from "@/server/auth";

export const metadata = { title: "Sin acceso" };

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requireSession();
  const { m } = await searchParams;
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <ShieldAlert size={40} className="mx-auto text-warning" />
      <h1 className="h2 mt-3">Sin acceso a este módulo</h1>
      <p className="mt-2 text-[13px] text-ink-500">Su rol ({s.user.roles.join(", ")}) no tiene permisos para {m ? `el módulo “${m}”` : "esta sección"}. Solicite acceso a un administrador.</p>
      <Link href="/dashboard" className="btn-primary mt-5">Volver al inicio</Link>
    </div>
  );
}
