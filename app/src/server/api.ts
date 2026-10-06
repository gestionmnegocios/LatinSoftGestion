import { NextResponse } from "next/server";
import { getSession } from "./auth";

/** Las rutas REST usan la misma sesión y verifican permisos en el backend. */
export async function apiSession(permission?: string) {
  const s = await getSession();
  if (!s) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (permission && !s.ctx.permissions.has("*") && !s.ctx.permissions.has(permission)) {
    return { error: NextResponse.json({ error: "forbidden", permission }, { status: 403 }) };
  }
  return { s };
}
