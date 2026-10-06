import { z } from "zod";
import { prisma, DomainError, requirePermission, round2, type Ctx } from "../db";
import { audit } from "./common";
import { hashPassword } from "../password";

const num = z.coerce.number().min(0, "Debe ser mayor o igual a 0");

export const productSchema = z.object({
  id: z.string().optional(),
  sku: z.string().trim().min(1, "SKU requerido").max(40),
  barcode: z.string().trim().optional().nullable(),
  name: z.string().trim().min(2, "Nombre requerido"),
  description: z.string().trim().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  unit: z.string().trim().min(1).default("UND"),
  taxRate: num.max(100),
  salePrice: num,
  averageCost: num.optional(),
  minimumStock: num,
  maximumStock: num,
  safetyStock: num,
  reorderPoint: num.optional(),
  location: z.string().trim().optional().nullable(),
  trackLot: z.coerce.boolean().optional(),
  trackExpiration: z.coerce.boolean().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export async function saveProduct(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "products.manage");
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0].message);
  const d = parsed.data;
  if (d.maximumStock > 0 && d.maximumStock < d.minimumStock) throw new DomainError("El stock máximo no puede ser menor que el mínimo.");
  const dup = await prisma.product.findFirst({ where: { organizationId: ctx.orgId, sku: d.sku, NOT: d.id ? { id: d.id } : undefined } });
  if (dup) throw new DomainError(`Ya existe un producto con SKU ${d.sku}.`);
  const data = {
    sku: d.sku, barcode: d.barcode || null, name: d.name, description: d.description || null, categoryId: d.categoryId || null,
    unit: d.unit, taxRate: d.taxRate, salePrice: d.salePrice, minimumStock: d.minimumStock, maximumStock: d.maximumStock,
    safetyStock: d.safetyStock, reorderPoint: d.reorderPoint ?? d.minimumStock + d.safetyStock, location: d.location || null,
    trackLot: !!d.trackLot, trackExpiration: !!d.trackExpiration, status: d.status,
  };
  return prisma.$transaction(async (tx) => {
    if (d.id) {
      const old = await tx.product.findFirstOrThrow({ where: { id: d.id, organizationId: ctx.orgId } });
      const p = await tx.product.update({ where: { id: d.id }, data });
      if (old.salePrice !== p.salePrice) {
        const def = await tx.priceList.findFirst({ where: { organizationId: ctx.orgId, isDefault: true } });
        if (def) await tx.productPrice.upsert({ where: { priceListId_productId: { priceListId: def.id, productId: p.id } }, create: { priceListId: def.id, productId: p.id, price: p.salePrice }, update: { price: p.salePrice } });
      }
      // Auditoría especial para precios (PRD §22)
      await audit(tx, ctx, "product.update", "Product", p.id,
        { salePrice: old.salePrice, minimumStock: old.minimumStock, name: old.name },
        { salePrice: p.salePrice, minimumStock: p.minimumStock, name: p.name });
      return p;
    }
    const p = await tx.product.create({ data: { ...data, organizationId: ctx.orgId, averageCost: d.averageCost ?? 0, lastCost: d.averageCost ?? 0 } });
    const lists = await tx.priceList.findMany({ where: { organizationId: ctx.orgId } });
    for (const l of lists) {
      await tx.productPrice.create({ data: { priceListId: l.id, productId: p.id, price: l.isDefault ? p.salePrice : Math.round((p.salePrice * 0.92) / 100) * 100 } });
    }
    await audit(tx, ctx, "product.create", "Product", p.id, undefined, { sku: p.sku, name: p.name, salePrice: p.salePrice });
    return p;
  });
}

export const customerSchema = z.object({
  id: z.string().optional(),
  documentType: z.string().default("NIT"),
  documentNumber: z.string().trim().min(3, "Documento requerido"),
  name: z.string().trim().min(2, "Razón social requerida"),
  tradeName: z.string().trim().optional().nullable(),
  contactName: z.string().trim().optional().nullable(),
  email: z.union([z.string().trim().email("Email inválido"), z.literal("")]).optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  priceListId: z.string().optional().nullable(),
  creditLimit: num,
  creditDays: z.coerce.number().int().min(0),
});

export async function saveCustomer(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "customers.manage");
  const parsed = customerSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0].message);
  const { id, ...d } = parsed.data;
  const data = { ...d, email: d.email || null, priceListId: d.priceListId || null };
  return prisma.$transaction(async (tx) => {
    if (id) {
      const old = await tx.customer.findFirstOrThrow({ where: { id, organizationId: ctx.orgId } });
      const c = await tx.customer.update({ where: { id }, data });
      await audit(tx, ctx, "customer.update", "Customer", id, { creditLimit: old.creditLimit, creditDays: old.creditDays }, { creditLimit: c.creditLimit, creditDays: c.creditDays });
      return c;
    }
    const c = await tx.customer.create({ data: { ...data, organizationId: ctx.orgId } });
    await audit(tx, ctx, "customer.create", "Customer", c.id, undefined, { name: c.name });
    return c;
  });
}

export const supplierSchema = z.object({
  id: z.string().optional(),
  taxId: z.string().trim().min(3, "NIT requerido"),
  legalName: z.string().trim().min(2, "Razón social requerida"),
  tradeName: z.string().trim().optional().nullable(),
  contactName: z.string().trim().optional().nullable(),
  email: z.union([z.string().trim().email("Email inválido"), z.literal("")]).optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  paymentTerms: z.string().trim().default("Contado"),
  creditDays: z.coerce.number().int().min(0),
  averageLeadTime: z.coerce.number().int().min(0),
  shippingCost: num,
  fulfillmentRating: z.coerce.number().min(0).max(5),
});

export async function saveSupplier(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "suppliers.manage");
  const parsed = supplierSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0].message);
  const { id, ...d } = parsed.data;
  const data = { ...d, email: d.email || null };
  return prisma.$transaction(async (tx) => {
    if (id) {
      await tx.supplier.findFirstOrThrow({ where: { id, organizationId: ctx.orgId } });
      const s = await tx.supplier.update({ where: { id }, data });
      await audit(tx, ctx, "supplier.update", "Supplier", id, undefined, data);
      return s;
    }
    const s = await tx.supplier.create({ data: { ...data, organizationId: ctx.orgId } });
    await audit(tx, ctx, "supplier.create", "Supplier", s.id, undefined, { legalName: s.legalName });
    return s;
  });
}

export async function saveSupplierProduct(
  ctx: Ctx,
  input: { supplierId: string; productId: string; price: number; supplierSku?: string; minimumOrderQuantity?: number; leadTimeDays?: number; discountPct?: number; isPreferred?: boolean },
) {
  requirePermission(ctx, "suppliers.manage");
  if (!input.productId) throw new DomainError("Seleccione un producto.");
  if (!(input.price > 0)) throw new DomainError("El precio debe ser mayor a 0.");
  await prisma.supplier.findFirstOrThrow({ where: { id: input.supplierId, organizationId: ctx.orgId } });
  return prisma.$transaction(async (tx) => {
    if (input.isPreferred) {
      await tx.supplierProduct.updateMany({ where: { productId: input.productId, organizationId: ctx.orgId }, data: { isPreferred: false } });
    }
    const data = {
      price: input.price, supplierSku: input.supplierSku || null, minimumOrderQuantity: input.minimumOrderQuantity || 1,
      leadTimeDays: input.leadTimeDays ?? 3, discountPct: input.discountPct ?? 0, isPreferred: !!input.isPreferred,
    };
    const sp = await tx.supplierProduct.upsert({
      where: { supplierId_productId: { supplierId: input.supplierId, productId: input.productId } },
      create: { ...data, organizationId: ctx.orgId, supplierId: input.supplierId, productId: input.productId },
      update: data,
    });
    await audit(tx, ctx, "supplier_product.save", "SupplierProduct", sp.id, undefined, data);
    return sp;
  });
}

export async function removeSupplierProduct(ctx: Ctx, id: string) {
  requirePermission(ctx, "suppliers.manage");
  await prisma.$transaction(async (tx) => {
    const sp = await tx.supplierProduct.findFirstOrThrow({ where: { id, organizationId: ctx.orgId } });
    await tx.supplierProduct.update({ where: { id }, data: { status: "INACTIVE" } });
    await audit(tx, ctx, "supplier_product.remove", "SupplierProduct", id, { price: sp.price }, { status: "INACTIVE" });
  });
}

export async function createUser(ctx: Ctx, input: { name: string; email: string; password: string; roleId: string }) {
  requirePermission(ctx, "settings.manage");
  if (input.name.trim().length < 2) throw new DomainError("Nombre requerido.");
  if (!/^\S+@\S+\.\S+$/.test(input.email)) throw new DomainError("Email inválido.");
  if (input.password.length < 8) throw new DomainError("La contraseña debe tener al menos 8 caracteres.");
  const exists = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (exists) throw new DomainError("Ya existe un usuario con ese email.");
  await prisma.role.findFirstOrThrow({ where: { id: input.roleId, organizationId: ctx.orgId } });
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { organizationId: ctx.orgId, name: input.name.trim(), email: input.email.toLowerCase(), passwordHash: hashPassword(input.password), roles: { create: { roleId: input.roleId } } },
    });
    await audit(tx, ctx, "user.create", "User", u.id, undefined, { email: u.email, roleId: input.roleId });
    return u;
  });
}

export async function setUserRole(ctx: Ctx, userId: string, roleId: string) {
  requirePermission(ctx, "settings.manage");
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.findFirstOrThrow({ where: { id: userId, organizationId: ctx.orgId }, include: { roles: true } });
    await tx.role.findFirstOrThrow({ where: { id: roleId, organizationId: ctx.orgId } });
    if (u.id === ctx.userId) throw new DomainError("No puede cambiar su propio rol.");
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.userRole.create({ data: { userId, roleId } });
    await audit(tx, ctx, "user.role", "User", userId, { roles: u.roles.map((r) => r.roleId) }, { roles: [roleId] });
  });
}

export async function toggleUserStatus(ctx: Ctx, userId: string) {
  requirePermission(ctx, "settings.manage");
  if (userId === ctx.userId) throw new DomainError("No puede desactivar su propio usuario.");
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.findFirstOrThrow({ where: { id: userId, organizationId: ctx.orgId } });
    const status = u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    await tx.user.update({ where: { id: userId }, data: { status } });
    if (status === "INACTIVE") await tx.session.deleteMany({ where: { userId } });
    await audit(tx, ctx, "user.status", "User", userId, { status: u.status }, { status });
  });
}

export async function registerCashMovement(ctx: Ctx, type: "IN" | "OUT", amount: number, concept: string) {
  requirePermission(ctx, "finance.cash");
  if (!(amount > 0)) throw new DomainError("El valor debe ser mayor a 0.");
  if (!concept.trim()) throw new DomainError("Indique el concepto.");
  await prisma.$transaction(async (tx) => {
    const m = await tx.cashMovement.create({ data: { organizationId: ctx.orgId, type, amount, concept: concept.trim(), userId: ctx.userId } });
    await audit(tx, ctx, "cash.movement", "CashMovement", m.id, undefined, { type, amount, concept });
  });
}

export async function closeCash(ctx: Ctx, counted: number) {
  requirePermission(ctx, "finance.cash");
  const last = await prisma.cashClosing.findFirst({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" } });
  const since = last?.createdAt ?? new Date(0);
  const movs = await prisma.cashMovement.findMany({ where: { organizationId: ctx.orgId, createdAt: { gt: since } } });
  const totalIn = movs.filter((m) => m.type === "IN").reduce((s, m) => s + m.amount, 0);
  const totalOut = movs.filter((m) => m.type === "OUT").reduce((s, m) => s + m.amount, 0);
  const opening = last?.counted ?? 0;
  const expected = round2(opening + totalIn - totalOut);
  return prisma.$transaction(async (tx) => {
    const c = await tx.cashClosing.create({
      data: { organizationId: ctx.orgId, openingAmount: opening, totalIn: round2(totalIn), totalOut: round2(totalOut), expected, counted, difference: round2(counted - expected), userId: ctx.userId },
    });
    await audit(tx, ctx, "cash.close", "CashClosing", c.id, undefined, { expected, counted });
    return c;
  });
}

// ── Importación / exportación CSV de productos ──
export const PRODUCT_CSV_COLUMNS = ["sku", "barcode", "name", "category", "unit", "taxRate", "averageCost", "salePrice", "minimumStock", "maximumStock", "safetyStock"] as const;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const sep = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export async function importProducts(ctx: Ctx, csv: string) {
  requirePermission(ctx, "products.manage");
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new DomainError("El archivo no tiene filas de datos.");
  const header = rows[0].map((h) => h.trim());
  const idx = (k: string) => header.indexOf(k);
  for (const req of ["sku", "name", "salePrice"]) if (idx(req) < 0) throw new DomainError(`Falta la columna "${req}". Use el formato de Exportar.`);
  const cats = await prisma.category.findMany({ where: { organizationId: ctx.orgId } });
  let created = 0, updated = 0;
  const errors: string[] = [];
  for (const [n, r] of rows.slice(1).entries()) {
    const get = (k: string) => (idx(k) >= 0 ? (r[idx(k)] ?? "").trim() : "");
    const numv = (k: string, d = 0) => {
      let v = get(k).replace(/[$\s]/g, "");
      if (v === "") return d;
      v = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v) ? v.replace(/\./g, "").replace(",", ".") : v.replace(",", ".");
      const x = Number(v);
      if (!Number.isFinite(x)) throw new DomainError(`valor inválido en ${k}: "${get(k)}"`);
      return x;
    };
    try {
      let categoryId: string | null = null;
      const catName = get("category");
      if (catName) {
        let c = cats.find((x) => x.name.toLowerCase() === catName.toLowerCase());
        if (!c) { c = await prisma.category.create({ data: { organizationId: ctx.orgId, name: catName } }); cats.push(c); }
        categoryId = c.id;
      }
      const existing = await prisma.product.findFirst({ where: { organizationId: ctx.orgId, sku: get("sku") } });
      await saveProduct(ctx, {
        id: existing?.id, sku: get("sku"), barcode: get("barcode") || null, name: get("name"), categoryId,
        unit: get("unit") || existing?.unit || "UND", taxRate: numv("taxRate", existing?.taxRate ?? 19), salePrice: numv("salePrice"),
        averageCost: numv("averageCost"), minimumStock: numv("minimumStock", existing?.minimumStock ?? 0),
        maximumStock: numv("maximumStock", existing?.maximumStock ?? 0), safetyStock: numv("safetyStock", existing?.safetyStock ?? 0),
        location: existing?.location, status: "ACTIVE",
      });
      if (existing) updated++; else created++;
    } catch (e) {
      errors.push(`fila ${n + 2}: ${(e as Error).message}`);
    }
  }
  return { created, updated, errors };
}
