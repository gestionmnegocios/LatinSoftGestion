import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
export { hashPassword, verifyPassword } from "./password";
import { cache } from "react";
import { prisma, type Ctx } from "./db";
import { MODULE_ACCESS, hasAny } from "./permissions";

export const SESSION_COOKIE = "ls_session";
export const WAREHOUSE_COOKIE = "ls_wh";

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { token, userId, expiresAt: new Date(Date.now() + 7 * 86400000) } });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 86400 });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { token } });
  jar.delete(SESSION_COOKIE);
}

export type SessionInfo = {
  ctx: Ctx;
  user: { id: string; name: string; email: string; roles: string[] };
  org: { id: string; name: string };
  warehouses: { id: string; name: string; code: string }[];
};

/** Resuelve la sesión una vez por request. La seguridad se aplica en el backend (servicios). */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { organization: true, roles: { include: { role: { include: { permissions: true } } } } } } },
  });
  if (!s || s.expiresAt < new Date() || s.user.status !== "ACTIVE") return null;
  const permissions = new Set<string>();
  for (const ur of s.user.roles) for (const p of ur.role.permissions) permissions.add(p.permission);
  const warehouses = await prisma.warehouse.findMany({
    where: { organizationId: s.user.organizationId, status: "ACTIVE" },
    orderBy: { code: "asc" },
    select: { id: true, name: true, code: true },
  });
  const whCookie = jar.get(WAREHOUSE_COOKIE)?.value;
  const warehouseId = warehouses.find((w) => w.id === whCookie)?.id ?? warehouses[0]?.id ?? "";
  return {
    ctx: { orgId: s.user.organizationId, userId: s.user.id, userName: s.user.name, permissions, warehouseId },
    user: { id: s.user.id, name: s.user.name, email: s.user.email, roles: s.user.roles.map((r) => r.role.name) },
    org: { id: s.user.organizationId, name: s.user.organization.name },
    warehouses,
  };
});

/** Exige sesión y, opcionalmente, acceso al módulo (verificado en el servidor, no solo ocultando menús). */
export async function requireSession(module?: keyof typeof MODULE_ACCESS) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (module && !hasAny(s.ctx.permissions, MODULE_ACCESS[module])) redirect(`/sin-acceso?m=${module}`);
  return s;
}

export function can(s: SessionInfo, permission: string) {
  return s.ctx.permissions.has("*") || s.ctx.permissions.has(permission);
}
