import { requireSession, can } from "@/server/auth";
import { prisma } from "@/server/db";
import { PERMISSIONS } from "@/server/permissions";
import { PageHeader, Card, Tabs, Badge } from "@/components/ui";
import { UsersAdmin } from "./UsersAdmin";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Configuración" };

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Inicio de sesión", "inventory.adjust": "Ajuste de inventario", "inventory.transfer": "Transferencia",
  "product.create": "Producto creado", "product.update": "Producto modificado", "quotation.create": "Cotización creada",
  "sales_order.create": "Pedido creado", "sales_order.dispatch": "Despacho", "purchase_order.create": "OC creada",
  "purchase_order.sent": "OC enviada", "purchase_order.confirmed": "OC confirmada", "goods_receipt.confirm": "Recepción confirmada",
  "payment.create": "Pago registrado", "payable.pay": "Pago a proveedor", "user.create": "Usuario creado", "user.role": "Cambio de rol",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession();
  const { tab = "empresa" } = await searchParams;
  const O = s.ctx.orgId;
  const admin = can(s, "settings.manage");
  const [org, company, warehouses, users, roles, logs] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: O } }),
    prisma.company.findFirst({ where: { organizationId: O }, include: { branches: true } }),
    prisma.warehouse.findMany({ where: { organizationId: O }, include: { branch: true, _count: { select: { balances: true } } }, orderBy: { code: "asc" } }),
    prisma.user.findMany({ where: { organizationId: O }, include: { roles: { include: { role: true } } }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ where: { organizationId: O }, include: { permissions: true }, orderBy: { name: "asc" } }),
    admin ? prisma.auditLog.findMany({ where: { organizationId: O }, orderBy: { createdAt: "desc" }, take: 60 }) : Promise.resolve([]),
  ]);
  const tabs = [
    { key: "empresa", label: "Empresa y bodegas", href: "?tab=empresa" },
    { key: "usuarios", label: "Usuarios", href: "?tab=usuarios" },
    { key: "roles", label: "Roles y permisos", href: "?tab=roles" },
    ...(admin ? [{ key: "auditoria", label: "Auditoría", href: "?tab=auditoria" }] : []),
  ];
  return (
    <div>
      <PageHeader title="Configuración" subtitle="Organización, bodegas, usuarios, permisos y auditoría" />
      <div className="mb-4"><Tabs active={tab} tabs={tabs} /></div>
      {tab === "empresa" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Organización">
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <div><dt className="text-xs text-ink-500">Razón social</dt><dd className="font-medium">{company?.legalName}</dd></div>
              <div><dt className="text-xs text-ink-500">NIT</dt><dd>{company?.taxId}</dd></div>
              <div><dt className="text-xs text-ink-500">País / moneda</dt><dd>{org.country} · {org.currency}</dd></div>
              <div><dt className="text-xs text-ink-500">Zona horaria</dt><dd>{org.timezone}</dd></div>
              <div><dt className="text-xs text-ink-500">Dirección</dt><dd>{company?.address}</dd></div>
              <div><dt className="text-xs text-ink-500">Sucursales</dt><dd>{company?.branches.map((b) => b.name).join(", ")}</dd></div>
            </dl>
          </Card>
          <Card title="Bodegas" bodyClassName="overflow-x-auto">
            <table className="table"><thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Sucursal</th><th className="text-right">Productos</th></tr></thead><tbody>
              {warehouses.map((w) => <tr key={w.id}><td className="font-mono text-xs">{w.code}</td><td>{w.name}</td><td><Badge>{({ MAIN: "Principal", SALES: "Venta", TRANSIT: "Tránsito", RETURNS: "Devoluciones", DAMAGED: "Averías" } as Record<string, string>)[w.type]}</Badge></td><td>{w.branch?.name}</td><td className="num text-right">{w._count.balances}</td></tr>)}
            </tbody></table>
          </Card>
        </div>
      )}
      {tab === "usuarios" && (
        <UsersAdmin
          canManage={admin}
          currentUserId={s.user.id}
          roles={roles.map((r) => ({ id: r.id, name: r.name }))}
          users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, status: u.status, roleId: u.roles[0]?.roleId ?? "", lastLoginAt: u.lastLoginAt?.toISOString() ?? null }))}
        />
      )}
      {tab === "roles" && (
        <div className="card overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead><tr><th>Permiso</th>{roles.map((r) => <th key={r.id} className="text-center">{r.name}</th>)}</tr></thead>
            <tbody>
              {Object.entries(PERMISSIONS).map(([k, label]) => (
                <tr key={k}>
                  <td>{label}<div className="font-mono text-[11px] text-ink-500">{k}</div></td>
                  {roles.map((r) => { const has = r.permissions.some((p) => p.permission === "*" || p.permission === k); return <td key={r.id} className="text-center">{has ? <span className="font-bold text-success">✓</span> : <span className="text-line-300">—</span>}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-4 text-xs text-ink-500">Los permisos se verifican en el backend en cada operación, no solo ocultando botones.</p>
        </div>
      )}
      {tab === "auditoria" && admin && (
        <div className="card overflow-x-auto">
          <table className="table min-w-[900px]">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Valor anterior</th><th>Valor nuevo</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{dateTime(l.createdAt)}</td>
                  <td>{l.userName}</td>
                  <td>{ACTION_LABELS[l.action] ?? l.action}</td>
                  <td className="text-xs">{l.entity}</td>
                  <td className="max-w-56 truncate font-mono text-[11px] text-ink-500" title={l.oldValue ?? ""}>{l.oldValue ?? "—"}</td>
                  <td className="max-w-72 truncate font-mono text-[11px]" title={l.newValue ?? ""}>{l.newValue ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
