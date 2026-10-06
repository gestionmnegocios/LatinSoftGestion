import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Ingresar" };

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-navy-900 p-12 text-white lg:flex">
        <Logo size={28} />
        <div>
          <h1 className="text-[34px] font-bold leading-tight">
            Sabe qué tienes, qué estás vendiendo, qué te falta y a quién debes comprárselo.
          </h1>
          <ul className="mt-8 space-y-3 text-[15px] text-white/80">
            <li>✓ Cotiza verificando disponibilidad en tiempo real</li>
            <li>✓ Detecta faltantes y calcula cuánto comprar</li>
            <li>✓ Compara proveedores más allá del precio</li>
            <li>✓ Recibe mercancía y completa pedidos automáticamente</li>
          </ul>
        </div>
        <p className="text-xs text-white/50">© 2026 LatinSoftGestion</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo dark size={26} /></div>
          <h2 className="h1">Ingresar</h2>
          <p className="mb-6 mt-1 text-ink-500">Accede a tu cuenta de LatinSoftGestion</p>
          <LoginForm />
          <div className="mt-6 rounded-lg border border-line-200 bg-white p-3 text-xs text-ink-500">
            <b className="text-ink-700">Cuentas demo</b> (contraseña <code>Demo2026!</code>): admin@, ventas@, bodega@, compras@, caja@ <span className="whitespace-nowrap">latinsoft.co</span>
          </div>
        </div>
      </div>
    </div>
  );
}
