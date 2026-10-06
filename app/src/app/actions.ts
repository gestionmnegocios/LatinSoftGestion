"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma, DomainError, type Ctx } from "@/server/db";
import { createSession, destroySession, getSession, verifyPassword, WAREHOUSE_COOKIE } from "@/server/auth";
import * as sales from "@/server/services/sales";
import * as inv from "@/server/services/inventory";
import * as proc from "@/server/services/procurement";
import * as purch from "@/server/services/purchasing";
import * as cat from "@/server/services/catalog";
import { askCopilot } from "@/server/ai/copilot";

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function ctx(): Promise<Ctx> {
  const s = await getSession();
  if (!s) throw new DomainError("Su sesión expiró. Ingrese de nuevo.");
  return s.ctx;
}

async function run<T>(fn: (c: Ctx) => Promise<T>, revalidate: string[] = ["/"]): Promise<ActionResult<T>> {
  try {
    const data = await fn(await ctx());
    for (const p of revalidate) revalidatePath(p, "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return { ok: false, error: "El registro no existe o no pertenece a su empresa." };
    console.error(e);
    return { ok: false, error: "Ocurrió un error inesperado. Intente de nuevo." };
  }
}

// ── Sesión ──
export async function loginAction(_: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE" || !verifyPassword(password, user.passwordHash)) {
    return { error: "Email o contraseña incorrectos." };
  }
  await createSession(user.id);
  await prisma.auditLog.create({ data: { organizationId: user.organizationId, userId: user.id, userName: user.name, action: "auth.login", entity: "User", entityId: user.id } });
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function setWarehouseAction(id: string) {
  const s = await getSession();
  if (!s || !s.warehouses.some((w) => w.id === id)) return;
  (await cookies()).set(WAREHOUSE_COOKIE, id, { path: "/", sameSite: "lax", maxAge: 365 * 86400 });
  revalidatePath("/", "layout");
}

// ── Ventas ──
export async function saveQuoteAction(input: sales.QuoteInput, status: "DRAFT" | "SENT") {
  return run(async (c) => (await sales.saveQuotation(c, input, status)).id);
}
export async function quoteStatusAction(id: string, status: "SENT" | "REJECTED" | "ACCEPTED") {
  return run((c) => sales.setQuotationStatus(c, id, status));
}
export async function duplicateQuoteAction(id: string) {
  return run(async (c) => (await sales.duplicateQuotation(c, id)).id);
}
export async function convertQuoteAction(id: string) {
  return run(async (c) => {
    const r = await sales.convertQuotationToOrder(c, id);
    return { orderId: r.order.id, number: r.order.number, shortages: r.shortages };
  });
}
export async function orderAction(id: string, op: "prepare" | "dispatch" | "deliver" | "cancel" | "invoice") {
  return run(async (c) => {
    if (op === "prepare") return sales.prepareOrder(c, id);
    if (op === "dispatch") return sales.dispatchOrder(c, id);
    if (op === "deliver") return sales.deliverOrder(c, id);
    if (op === "cancel") return sales.cancelOrder(c, id);
    return (await sales.invoiceOrder(c, id)).id;
  });
}
export async function paymentAction(invoiceId: string, amount: number, method: string) {
  return run((c) => sales.registerPayment(c, invoiceId, amount, method));
}

// ── Catálogo ──
export async function saveProductAction(data: unknown) {
  return run(async (c) => (await cat.saveProduct(c, data)).id);
}
export async function saveCustomerAction(data: unknown) {
  return run(async (c) => (await cat.saveCustomer(c, data)).id);
}
export async function saveSupplierAction(data: unknown) {
  return run(async (c) => (await cat.saveSupplier(c, data)).id);
}
export async function saveSupplierProductAction(data: Parameters<typeof cat.saveSupplierProduct>[1]) {
  return run(async (c) => (await cat.saveSupplierProduct(c, data)).id);
}
export async function importProductsAction(csv: string) {
  return run((c) => cat.importProducts(c, csv));
}
export async function removeSupplierProductAction(id: string) {
  return run((c) => cat.removeSupplierProduct(c, id));
}

// ── Inventario ──
export async function adjustAction(input: { productId: string; warehouseId: string; newQuantity: number; reason: string }) {
  return run(async (c) => { await inv.adjustInventory(c, input); });
}
export async function transferAction(input: Parameters<typeof inv.transferInventory>[1]) {
  return run(async (c) => (await inv.transferInventory(c, input)).number);
}

// ── Compras ──
export async function createRequirementAction(warehouseId: string, items: { productId: string; quantity: number }[], horizon: number) {
  return run(async (c) => (await proc.createRequirement(c, warehouseId, items, horizon)).id);
}
export async function ordersFromComparisonAction(requirementId: string, choice: string) {
  return run((c) => proc.createOrdersFromComparison(c, requirementId, choice));
}
export async function createPurchaseOrderAction(input: Parameters<typeof purch.createPurchaseOrder>[1]) {
  return run(async (c) => (await purch.createPurchaseOrder(c, input)).id);
}
export async function poTransitionAction(id: string, to: string) {
  return run((c) => purch.transitionPurchaseOrder(c, id, to));
}
export async function receiveAction(poId: string, lines: purch.ReceiptLine[], notes?: string) {
  return run(async (c) => {
    const r = await purch.confirmGoodsReceipt(c, poId, lines, notes);
    return { number: r.receipt.number, status: r.status };
  });
}
export async function payPayableAction(id: string) {
  return run((c) => purch.payPayable(c, id));
}

// ── Finanzas ──
export async function cashMovementAction(type: "IN" | "OUT", amount: number, concept: string) {
  return run((c) => cat.registerCashMovement(c, type, amount, concept));
}
export async function closeCashAction(counted: number) {
  return run(async (c) => { await cat.closeCash(c, counted); });
}

// ── Configuración ──
export async function createUserAction(input: { name: string; email: string; password: string; roleId: string }) {
  return run(async (c) => { await cat.createUser(c, input); });
}
export async function setUserRoleAction(userId: string, roleId: string) {
  return run((c) => cat.setUserRole(c, userId, roleId));
}
export async function toggleUserAction(userId: string) {
  return run((c) => cat.toggleUserStatus(c, userId));
}

// ── Notificaciones / IA ──
export async function markNotificationsReadAction() {
  return run(async (c) => { await prisma.notification.updateMany({ where: { organizationId: c.orgId, read: false }, data: { read: true } }); });
}
export async function askCopilotAction(question: string, history: { role: "user" | "assistant"; content: string }[]) {
  return run(async (c) => {
    if (!c.permissions.has("*") && !c.permissions.has("ai.use")) throw new DomainError("Su rol no tiene acceso al Copiloto IA.");
    return askCopilot(c, question, history);
  });
}
