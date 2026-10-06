"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import clsx from "clsx";
import {
  Home, ShoppingCart, FileText, ClipboardList, Receipt, Users, Package, Boxes, ArrowLeftRight, Repeat, Bell,
  ShoppingBag, ListChecks, Scale, FileCheck2, PackageCheck, Truck, Wallet, BarChart3, Sparkles, Settings, Search,
  Menu, X, LogOut, ChevronDown, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { Logo } from "./Logo";
import { Toaster } from "./Toast";
import { logoutAction, markNotificationsReadAction, setWarehouseAction } from "@/app/actions";

type NavItem = { href: string; label: string; icon: typeof Home };
type NavGroup = { label?: string; icon?: typeof Home; module?: string; items: (NavItem & { module?: string })[] };

const NAV: NavGroup[] = [
  { items: [{ href: "/dashboard", label: "Inicio", icon: Home }] },
  {
    label: "Ventas", icon: ShoppingCart, module: "ventas",
    items: [
      { href: "/ventas/cotizaciones", label: "Cotizaciones", icon: FileText },
      { href: "/ventas/pedidos", label: "Pedidos", icon: ClipboardList },
      { href: "/ventas/facturas", label: "Facturas", icon: Receipt },
      { href: "/ventas/clientes", label: "Clientes", icon: Users },
    ],
  },
  {
    label: "Inventario", icon: Package, module: "inventario",
    items: [
      { href: "/inventario/productos", label: "Productos", icon: Package },
      { href: "/inventario/existencias", label: "Existencias", icon: Boxes },
      { href: "/inventario/movimientos", label: "Movimientos", icon: Repeat },
      { href: "/inventario/transferencias", label: "Transferencias", icon: ArrowLeftRight },
      { href: "/inventario/alertas", label: "Alertas", icon: AlertTriangle },
    ],
  },
  {
    label: "Compras", icon: ShoppingBag, module: "compras",
    items: [
      { href: "/compras/necesidades", label: "Necesidades", icon: ListChecks },
      { href: "/compras/comparador", label: "Comparador", icon: Scale },
      { href: "/compras/ordenes", label: "Órdenes de compra", icon: FileCheck2 },
      { href: "/compras/recepciones", label: "Recepciones", icon: PackageCheck },
    ],
  },
  {
    items: [
      { href: "/proveedores", label: "Proveedores", icon: Truck, module: "proveedores" },
      { href: "/finanzas", label: "Caja y Finanzas", icon: Wallet, module: "finanzas" },
      { href: "/reportes", label: "Reportes", icon: BarChart3, module: "reportes" },
      { href: "/ia", label: "Inteligencia IA", icon: Sparkles, module: "ia" },
      { href: "/configuracion", label: "Configuración", icon: Settings },
    ],
  },
];

export type ShellProps = {
  children: ReactNode;
  modules: string[];
  user: { name: string; roles: string[] };
  orgName: string;
  warehouses: { id: string; name: string }[];
  warehouseId: string;
  notifications: { id: string; title: string; message: string; link: string | null; read: boolean; createdAt: string; type: string }[];
};

export function Shell({ children, modules, user, orgName, warehouses, warehouseId, notifications }: ShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-screen">
      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-navy-900 text-white transition-transform lg:translate-x-0 no-print",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Link href="/dashboard"><Logo size={20} /></Link>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X size={20} /></button>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-6">
          {NAV.filter((g) => !g.module || modules.includes(g.module)).map((g, gi) => (
            <div key={gi}>
              {g.label && (
                <div className="mb-1 flex items-center gap-2 px-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                  {g.label}
                </div>
              )}
              {g.items.filter((it) => !it.module || modules.includes(it.module)).map((it) => {
                const active = pathname === it.href || pathname.startsWith(it.href + "/");
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={clsx(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium",
                      active ? "bg-brand-600 text-white" : "text-white/80 hover:bg-navy-800 hover:text-white",
                    )}
                  >
                    <it.icon size={16} className={clsx(it.href === "/ia" && !active && "text-[#a99ffc]")} />
                    {it.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-3 text-[11px] text-white/45">v1.0 · MVP</div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="lg:pl-60">
        <Topbar
          onMenu={() => setOpen(true)}
          user={user}
          orgName={orgName}
          warehouses={warehouses}
          warehouseId={warehouseId}
          notifications={notifications}
        />
        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">{children}</main>
        <Toaster />
      </div>
    </div>
  );
}

function Topbar({ onMenu, user, orgName, warehouses, warehouseId, notifications }: Omit<ShellProps, "children" | "modules"> & { onMenu: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line-200 bg-white/95 px-4 backdrop-blur sm:px-6 no-print">
      <button className="lg:hidden" onClick={onMenu} aria-label="Abrir menú"><Menu size={22} /></button>
      <div className="hidden items-center gap-2 md:flex">
        <span className="text-xs font-medium text-ink-500">Empresa:</span>
        <select className="input w-48 py-1.5" defaultValue="1" aria-label="Empresa">
          <option value="1">{orgName}</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden text-xs font-medium text-ink-500 sm:inline">Bodega:</span>
        <select
          className={clsx("input w-36 py-1.5", pending && "opacity-60")}
          value={warehouseId}
          aria-label="Bodega"
          onChange={(e) => start(async () => { await setWarehouseAction(e.target.value); router.refresh(); })}
        >
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <form action="/buscar" className="relative ml-auto hidden max-w-xs flex-1 md:block">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
        <input name="q" placeholder="Buscar en el sistema… (SKU, código, cliente, documento)" className="input pl-9" />
      </form>
      <div className="ml-auto flex items-center gap-2 md:ml-0">
        <Link href="/buscar" className="rounded-lg p-2 text-ink-700 hover:bg-surface-100 md:hidden" aria-label="Buscar"><Search size={19} /></Link>
        <Notifications items={notifications} />
        <UserMenu name={user.name} role={user.roles[0] ?? ""} initials={initials} />
      </div>
    </header>
  );
}

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOutside(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onOutside]);
  return ref;
}

function Notifications({ items }: { items: ShellProps["notifications"] }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const router = useRouter();
  const unread = items.filter((n) => !n.read).length;
  return (
    <div className="relative" ref={ref}>
      <button className="relative rounded-lg p-2 text-ink-700 hover:bg-surface-100" onClick={() => setOpen((o) => !o)} aria-label="Notificaciones">
        <Bell size={19} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-line-200 px-4 py-2.5">
            <span className="font-semibold">Notificaciones</span>
            {unread > 0 && (
              <button className="text-xs font-medium text-brand-600" onClick={async () => { await markNotificationsReadAction(); router.refresh(); }}>
                Marcar como leídas
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="p-4 text-center text-ink-500">Sin notificaciones</p>}
            {items.map((n) => (
              <Link key={n.id} href={n.link ?? "#"} onClick={() => setOpen(false)} className={clsx("flex gap-3 border-b border-line-200 px-4 py-3 hover:bg-surface-50", !n.read && "bg-brand-50")}>
                {n.type === "ORDER_READY" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />}
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">{n.title}</div>
                  <div className="text-xs text-ink-500">{n.message}</div>
                  <div className="mt-0.5 text-[11px] text-ink-500">{new Date(n.createdAt).toLocaleString("es-CO")}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu({ name, role, initials }: { name: string; role: string; initials: string }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-surface-100" onClick={() => setOpen((o) => !o)}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-white">{initials}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[13px] font-semibold">{name}</span>
          <span className="block text-[11px] text-ink-500">{role}</span>
        </span>
        <ChevronDown size={14} className="text-ink-500" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 rounded-xl border border-line-200 bg-white p-1 shadow-xl">
          <Link href="/configuracion" className="block rounded-lg px-3 py-2 text-[13px] hover:bg-surface-100" onClick={() => setOpen(false)}>Configuración</Link>
          <form action={logoutAction}>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-danger hover:bg-danger-bg">
              <LogOut size={14} /> Cerrar sesión
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
