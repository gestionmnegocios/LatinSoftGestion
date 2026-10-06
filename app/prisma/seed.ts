/* Datos demo de LatinSoftGestion.
 * La historia (90 días) se escribe como movimientos de Kardex con fecha; el estado
 * actual (reservas, faltantes, OC en tránsito) se genera con los servicios reales. */
import { prisma, type Ctx } from "../src/server/db";
import { hashPassword } from "../src/server/password";
import { ROLE_TEMPLATES } from "../src/server/permissions";
import { saveQuotation, convertQuotationToOrder, setQuotationStatus } from "../src/server/services/sales";
import { createPurchaseOrder, transitionPurchaseOrder } from "../src/server/services/purchasing";

export const DEMO_PASSWORD = "Demo2026!";
const DAY = 86400000;

let seed = 20261005;
function rnd() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function poisson(l: number) {
  const L = Math.exp(-l); let k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > L);
  return k - 1;
}
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const r2 = (n: number) => Math.round(n * 100) / 100;

type P = { sku: string; name: string; cat: string; unit: string; cost: number; price: number; min: number; max: number; safety: number; rate: number; final: number; barcode: string; lot?: boolean };
const PRODUCTS: P[] = [
  { sku: "LIM001", name: "Detergente X 1 kg", cat: "Detergentes", unit: "UND", cost: 18000, price: 25000, min: 30, max: 150, safety: 10, rate: 3, final: 45, barcode: "7701234000011" },
  { sku: "LIM002", name: "Escoba Industrial", cat: "Implementos", unit: "UND", cost: 12000, price: 18000, min: 20, max: 80, safety: 6, rate: 1.6, final: 12, barcode: "7701234000028" },
  { sku: "LIM003", name: "Desinfectante 4 L", cat: "Desinfectantes", unit: "GAL", cost: 8000, price: 12000, min: 25, max: 120, safety: 8, rate: 2.2, final: 35, barcode: "7701234000035" },
  { sku: "LIM004", name: "Guantes de nitrilo x100", cat: "Implementos", unit: "CAJA", cost: 9000, price: 14000, min: 10, max: 60, safety: 5, rate: 1, final: 0, barcode: "7701234000042" },
  { sku: "LIM005", name: "Cloro 3,8 L", cat: "Desinfectantes", unit: "GAL", cost: 6000, price: 10000, min: 15, max: 80, safety: 5, rate: 1.2, final: 8, barcode: "7701234000059" },
  { sku: "LIM006", name: "Jabón Líquido 1 L", cat: "Detergentes", unit: "UND", cost: 7500, price: 12000, min: 30, max: 200, safety: 10, rate: 3, final: 120, barcode: "7701234000066" },
  { sku: "LIM007", name: "Papel Higiénico x12", cat: "Papeles", unit: "PAQ", cost: 15000, price: 22000, min: 40, max: 260, safety: 15, rate: 5, final: 200, barcode: "7701234000073" },
  { sku: "LIM008", name: "Toallas de manos x150", cat: "Papeles", unit: "PAQ", cost: 5500, price: 8500, min: 30, max: 200, safety: 10, rate: 2.5, final: 22, barcode: "7701234000080" },
  { sku: "LIM009", name: "Trapero microfibra", cat: "Implementos", unit: "UND", cost: 9500, price: 15000, min: 12, max: 60, safety: 4, rate: 0.8, final: 26, barcode: "7701234000097" },
  { sku: "LIM010", name: "Bolsas de basura x10", cat: "Implementos", unit: "PAQ", cost: 3200, price: 5500, min: 50, max: 300, safety: 20, rate: 4, final: 38, barcode: "7701234000103" },
  { sku: "LIM011", name: "Ambientador 400 ml", cat: "Desinfectantes", unit: "UND", cost: 6800, price: 11000, min: 15, max: 80, safety: 5, rate: 1.1, final: 0, barcode: "7701234000110" },
  { sku: "LIM012", name: "Limpiavidrios 500 ml", cat: "Detergentes", unit: "UND", cost: 5200, price: 8900, min: 12, max: 60, safety: 4, rate: 0.7, final: 31, barcode: "7701234000127" },
  { sku: "LIM013", name: "Recogedor con mango", cat: "Implementos", unit: "UND", cost: 7000, price: 11500, min: 8, max: 40, safety: 2, rate: 0.3, final: 64, barcode: "7701234000134" },
  { sku: "LIM014", name: "Balde 12 L", cat: "Implementos", unit: "UND", cost: 8500, price: 13500, min: 8, max: 40, safety: 2, rate: 0.3, final: 18, barcode: "7701234000141" },
  { sku: "LIM015", name: "Esponjas doble uso x3", cat: "Implementos", unit: "PAQ", cost: 2400, price: 4200, min: 30, max: 150, safety: 10, rate: 2, final: 75, barcode: "7701234000158" },
  { sku: "CAF001", name: "Café molido 500 g", cat: "Cafetería", unit: "UND", cost: 14500, price: 21000, min: 20, max: 100, safety: 6, rate: 1.8, final: 14, barcode: "7702000000011", lot: true },
  { sku: "CAF002", name: "Azúcar 1 kg", cat: "Cafetería", unit: "UND", cost: 3900, price: 5600, min: 25, max: 120, safety: 8, rate: 2, final: 70, barcode: "7702000000028", lot: true },
  { sku: "CAF003", name: "Vasos desechables 7 oz x50", cat: "Cafetería", unit: "PAQ", cost: 2900, price: 4800, min: 40, max: 250, safety: 15, rate: 3.5, final: 0, barcode: "7702000000035" },
  { sku: "CAF004", name: "Mezcladores x1000", cat: "Cafetería", unit: "PAQ", cost: 6200, price: 9800, min: 6, max: 30, safety: 2, rate: 0.2, final: 21, barcode: "7702000000042" },
  { sku: "CAF005", name: "Té surtido x20", cat: "Cafetería", unit: "CAJA", cost: 5400, price: 8700, min: 10, max: 50, safety: 3, rate: 0.6, final: 17, barcode: "7702000000059", lot: true },
  { sku: "PAP001", name: "Resma papel carta", cat: "Papelería", unit: "UND", cost: 16500, price: 23000, min: 20, max: 120, safety: 6, rate: 1.7, final: 48, barcode: "7703000000011" },
  { sku: "PAP002", name: "Bolígrafos negros x12", cat: "Papelería", unit: "CAJA", cost: 7800, price: 12500, min: 10, max: 60, safety: 3, rate: 0.5, final: 9, barcode: "7703000000028" },
  { sku: "PAP003", name: "Carpetas yute x10", cat: "Papelería", unit: "PAQ", cost: 6000, price: 9500, min: 8, max: 40, safety: 2, rate: 0.2, final: 120, barcode: "7703000000035" },
  { sku: "PAP004", name: "Cinta adhesiva transparente", cat: "Papelería", unit: "UND", cost: 2100, price: 3800, min: 20, max: 100, safety: 6, rate: 1, final: 0, barcode: "7703000000042" },
];

async function main() {
  console.log("→ Limpiando base de datos…");
  const tables = [
    "aIAction", "auditLog", "notification", "counter", "cashClosing", "cashMovement", "accountPayable", "payment", "invoice",
    "goodsReceiptItem", "goodsReceipt", "purchaseOrderItem", "purchaseOrder", "purchaseRequirementItem", "purchaseRequirement",
    "supplierProduct", "supplier", "salesOrderItem", "salesOrder", "quotationItem", "quotation", "customer", "transferItem", "transfer",
    "inventoryMovement", "inventoryBalance", "productPrice", "product", "priceList", "brand", "category",
    "session", "userRole", "rolePermission", "role", "user", "warehouse", "branch", "company", "organization",
  ] as const;
  for (const t of tables) await (prisma as any)[t].deleteMany();

  console.log("→ Organización, bodegas y usuarios…");
  const org = await prisma.organization.create({
    data: { name: "Comercial Demo S.A.S.", slug: "comercial-demo", taxId: "901.234.567-8" },
  });
  const O = org.id;
  const company = await prisma.company.create({
    data: { organizationId: O, legalName: "Comercial Demo S.A.S.", tradeName: "Comercial Demo", taxId: "901.234.567-8", address: "Cra 15 # 93-47", phone: "601 555 0101", email: "contacto@comercialdemo.co" },
  });
  const branch = await prisma.branch.create({ data: { organizationId: O, companyId: company.id, name: "Sede Principal", code: "SP", city: "Bogotá", address: "Cra 15 # 93-47" } });
  const whMain = await prisma.warehouse.create({ data: { organizationId: O, branchId: branch.id, code: "BOD-01", name: "Principal", type: "MAIN" } });
  await prisma.warehouse.create({ data: { organizationId: O, branchId: branch.id, code: "BOD-02", name: "Exhibición", type: "SALES" } });
  await prisma.warehouse.create({ data: { organizationId: O, branchId: branch.id, code: "BOD-03", name: "Averías", type: "DAMAGED" } });

  const roles: Record<string, string> = {};
  for (const r of ROLE_TEMPLATES) {
    const role = await prisma.role.create({
      data: { organizationId: O, key: r.key, name: r.name, permissions: { create: r.permissions.map((p) => ({ permission: p })) } },
    });
    roles[r.key] = role.id;
  }
  const pwd = hashPassword(DEMO_PASSWORD);
  const users = [
    { name: "Juan Martínez", email: "admin@latinsoft.co", role: "admin" },
    { name: "Laura Gómez", email: "ventas@latinsoft.co", role: "sales" },
    { name: "Carlos Ruiz", email: "bodega@latinsoft.co", role: "warehouse" },
    { name: "Ana Torres", email: "compras@latinsoft.co", role: "purchasing" },
    { name: "Pedro Díaz", email: "caja@latinsoft.co", role: "cashier" },
  ];
  let admin = null as null | { id: string; name: string };
  for (const u of users) {
    const user = await prisma.user.create({
      data: { organizationId: O, name: u.name, email: u.email, passwordHash: pwd, roles: { create: { roleId: roles[u.role] } } },
    });
    if (u.role === "admin") admin = user;
  }
  const ctx: Ctx = { orgId: O, userId: admin!.id, userName: admin!.name, permissions: new Set(["*"]), warehouseId: whMain.id };

  console.log("→ Catálogo…");
  const aseo = await prisma.category.create({ data: { organizationId: O, name: "Aseo" } });
  const catIds: Record<string, string> = {};
  for (const c of ["Detergentes", "Desinfectantes", "Implementos", "Papeles"]) {
    catIds[c] = (await prisma.category.create({ data: { organizationId: O, name: c, parentId: aseo.id } })).id;
  }
  for (const c of ["Cafetería", "Papelería"]) catIds[c] = (await prisma.category.create({ data: { organizationId: O, name: c } })).id;
  const brand = await prisma.brand.create({ data: { organizationId: O, name: "Genérica" } });
  const plGeneral = await prisma.priceList.create({ data: { organizationId: O, name: "General", isDefault: true } });
  const plMayor = await prisma.priceList.create({ data: { organizationId: O, name: "Mayorista" } });

  const prod: Record<string, { id: string } & P> = {};
  for (const p of PRODUCTS) {
    const created = await prisma.product.create({
      data: {
        organizationId: O, sku: p.sku, barcode: p.barcode, name: p.name, categoryId: catIds[p.cat], brandId: brand.id, unit: p.unit,
        averageCost: p.cost, lastCost: p.cost, salePrice: p.price, minimumStock: p.min, maximumStock: p.max, safetyStock: p.safety,
        reorderPoint: p.min + p.safety, trackLot: !!p.lot, trackExpiration: !!p.lot, location: `A-${p.sku.slice(-2)}`,
        prices: { create: [{ priceListId: plGeneral.id, price: p.price }, { priceListId: plMayor.id, price: Math.round((p.price * 0.92) / 100) * 100 }] },
      },
    });
    prod[p.sku] = { ...p, id: created.id };
  }

  console.log("→ Clientes y proveedores…");
  const customersData = [
    { documentNumber: "900.456.789-1", name: "Hotel Central S.A.S.", contactName: "Marcela Ríos", phone: "310 555 1200", city: "Bogotá", creditLimit: 15000000, creditDays: 30 },
    { documentNumber: "800.222.333-4", name: "Clínica San Rafael", contactName: "Andrés Peña", phone: "315 555 8890", city: "Bogotá", creditLimit: 25000000, creditDays: 45, mayor: true },
    { documentNumber: "901.888.777-2", name: "Restaurante El Fogón", contactName: "Diana López", phone: "320 555 4411", city: "Chía", creditLimit: 5000000, creditDays: 15 },
    { documentNumber: "860.111.555-9", name: "Colegio Los Andes", contactName: "Rector J. Vélez", phone: "601 555 3030", city: "Bogotá", creditLimit: 12000000, creditDays: 30 },
    { documentNumber: "901.333.444-0", name: "Oficinas Nova S.A.", contactName: "Paula Castro", phone: "311 555 7788", city: "Bogotá", creditLimit: 8000000, creditDays: 30 },
    { documentNumber: "79.555.123", name: "Tienda Don Pepe", contactName: "José Pérez", phone: "300 555 9900", city: "Soacha", creditLimit: 0, creditDays: 0, documentType: "CC" },
  ];
  const customers: Awaited<ReturnType<typeof prisma.customer.create>>[] = [];
  for (const c of customersData) {
    customers.push(await prisma.customer.create({
      data: {
        organizationId: O, documentType: c.documentType ?? "NIT", documentNumber: c.documentNumber, name: c.name, contactName: c.contactName, phone: c.phone,
        email: c.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 12) + "@correo.co", city: c.city, address: "Calle " + Math.floor(rnd() * 120) + " # " + Math.floor(rnd() * 90) + "-" + Math.floor(rnd() * 80),
        priceListId: c.mayor ? plMayor.id : plGeneral.id, creditLimit: c.creditLimit, creditDays: c.creditDays,
      },
    }));
  }

  const suppliersData = [
    { key: "alfa", taxId: "900.100.200-1", legalName: "Distribuciones Alfa S.A.S.", tradeName: "Distribuciones Alfa", contactName: "Ricardo Mejía", phone: "601 555 2020", creditDays: 30, paymentTerms: "Crédito", lead: 2, shipping: 0, rating: 4.6, factor: 1.0, cats: ["Detergentes", "Desinfectantes", "Implementos", "Papeles"] },
    { key: "beta", taxId: "900.300.400-2", legalName: "Suministros Beta Ltda.", tradeName: "Suministros Beta", contactName: "Sandra Vargas", phone: "601 555 3131", creditDays: 30, paymentTerms: "Crédito", lead: 5, shipping: 60000, rating: 4.5, factor: 0.965, cats: ["Detergentes", "Desinfectantes", "Implementos", "Papeles", "Cafetería"] },
    { key: "gamma", taxId: "901.500.600-3", legalName: "Comercial Gamma S.A.", tradeName: "Comercial Gamma", contactName: "Felipe Ortiz", phone: "601 555 4242", creditDays: 0, paymentTerms: "Contado", lead: 1, shipping: 90000, rating: 4.2, factor: 0.92, cats: ["Detergentes", "Desinfectantes"] },
    { key: "papeleria", taxId: "830.700.800-4", legalName: "Papelería y Café Central S.A.S.", tradeName: "Papelería Central", contactName: "Lucía Herrera", phone: "601 555 5353", creditDays: 15, paymentTerms: "Crédito", lead: 3, shipping: 25000, rating: 4.3, factor: 0.98, cats: ["Papelería", "Cafetería"] },
  ];
  const sup: Record<string, string> = {};
  for (const s of suppliersData) {
    const created = await prisma.supplier.create({
      data: {
        organizationId: O, taxId: s.taxId, legalName: s.legalName, tradeName: s.tradeName, contactName: s.contactName, phone: s.phone,
        email: `compras@${s.key}.co`, city: "Bogotá", address: "Zona Industrial Montevideo", paymentTerms: s.paymentTerms, creditDays: s.creditDays,
        averageLeadTime: s.lead, shippingCost: s.shipping, fulfillmentRating: s.rating,
      },
    });
    sup[s.key] = created.id;
    for (const p of PRODUCTS.filter((p) => s.cats.includes(p.cat))) {
      // Gamma no maneja implementos grandes ni todo el portafolio (cobertura parcial).
      if (s.key === "gamma" && ["LIM003"].includes(p.sku)) continue;
      await prisma.supplierProduct.create({
        data: {
          organizationId: O, supplierId: created.id, productId: prod[p.sku].id, supplierSku: `${s.key.toUpperCase().slice(0, 3)}-${p.sku}`,
          price: Math.round((p.cost * s.factor) / 50) * 50, minimumOrderQuantity: p.cat === "Papelería" ? 5 : 1,
          availableQuantity: s.key === "gamma" && p.sku === "LIM002" ? 15 : 9999, leadTimeDays: s.lead, isPreferred: s.key === (p.cat === "Papelería" || p.cat === "Cafetería" ? "papeleria" : "alfa"),
          discountPct: s.key === "beta" ? 0 : 0,
        },
      });
    }
  }

  console.log("→ Historia de ventas (90 días)…");
  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  type Sale = { sku: string; qty: number; date: Date; customerIdx: number };
  const sales: Sale[] = [];
  for (let d = 90; d >= 0; d--) {
    const day = new Date(startOfToday.getTime() - d * DAY);
    const dow = day.getDay();
    if (dow === 0) continue; // domingo cerrado
    const factor = (dow === 6 ? 0.5 : 1) * (0.85 + (90 - d) / 90 * 0.3) * (d === 0 ? 0.6 : 1);
    for (const p of PRODUCTS) {
      const q = poisson(p.rate * factor * 1.15);
      if (q > 0) sales.push({ sku: p.sku, qty: q, date: new Date(day.getTime() + (8 + Math.floor(rnd() * 9)) * 3600000), customerIdx: Math.floor(rnd() * customers.length) });
    }
  }
  // Agrupar por día+cliente en pedidos
  const orderGroups = new Map<string, Sale[]>();
  for (const s of sales) {
    const key = `${s.date.toDateString()}|${s.customerIdx}`;
    (orderGroups.get(key) ?? orderGroups.set(key, []).get(key)!).push(s);
  }
  const soldBySku: Record<string, number> = {};
  for (const s of sales) soldBySku[s.sku] = (soldBySku[s.sku] ?? 0) + s.qty;

  // Recepciones históricas a 60 y 25 días para enriquecer el kardex
  const receipts: { sku: string; qty: number; date: Date; supplier: string }[] = [];
  for (const p of PRODUCTS) {
    const supplier = p.cat === "Papelería" || p.cat === "Cafetería" ? "papeleria" : "alfa";
    receipts.push({ sku: p.sku, qty: Math.round(p.rate * 25), date: new Date(now - 60 * DAY), supplier });
    receipts.push({ sku: p.sku, qty: Math.round(p.rate * 25), date: new Date(now - 25 * DAY), supplier });
  }
  // Ajustar inicial para que el saldo final sea exactamente `final` y nunca negativo.
  const initial: Record<string, number> = {};
  for (const p of PRODUCTS) {
    const recv = receipts.filter((r) => r.sku === p.sku).reduce((s, r) => s + r.qty, 0);
    let init = p.final + (soldBySku[p.sku] ?? 0) - recv;
    // verificar trayectoria
    const events = [
      ...sales.filter((s) => s.sku === p.sku).map((s) => ({ t: s.date.getTime(), q: -s.qty })),
      ...receipts.filter((r) => r.sku === p.sku).map((r) => ({ t: r.date.getTime(), q: r.qty })),
    ].sort((a, b) => a.t - b.t);
    let run = init, minRun = init;
    for (const e of events) { run += e.q; minRun = Math.min(minRun, run); }
    if (minRun < 0) {
      // reforzar la primera recepción y reducir el inicial lo mismo no sirve: subimos recepción temprana
      const extra = -minRun;
      init += extra;
      // compensar con una salida por avería al final para cuadrar el saldo
      receipts.push({ sku: p.sku, qty: -extra, date: new Date(now - 2 * DAY), supplier: "adjust" });
    }
    initial[p.sku] = init;
  }

  const movements: any[] = [];
  const running: Record<string, number> = {};
  type Ev = { t: Date; sku: string; q: number; type: string; ref?: string; refId?: string; cost: number; notes?: string; lot?: string; exp?: Date };
  const events: Ev[] = [];
  for (const p of PRODUCTS) {
    events.push({ t: new Date(now - 95 * DAY), sku: p.sku, q: initial[p.sku], type: "POSITIVE_ADJUSTMENT", ref: "INV-INICIAL", cost: p.cost, notes: "Inventario inicial" });
  }

  // Órdenes de compra históricas recibidas
  let ocCounter = 0, recCounter = 0;
  const recByDateSupplier = new Map<string, typeof receipts>();
  for (const r of receipts) {
    if (r.supplier === "adjust") {
      events.push({ t: r.date, sku: r.sku, q: r.qty, type: "NEGATIVE_ADJUSTMENT", ref: "AJ-2026-0001", cost: prod[r.sku].cost, notes: "Ajuste por averías en conteo cíclico" });
      continue;
    }
    const k = `${r.date.getTime()}|${r.supplier}`;
    (recByDateSupplier.get(k) ?? recByDateSupplier.set(k, []).get(k)!).push(r);
  }
  for (const [k, list] of recByDateSupplier) {
    const [t, supplierKey] = k.split("|");
    const date = new Date(Number(t));
    const ocNum = `OC-2026-${String(++ocCounter + 140).padStart(5, "0")}`;
    const recNum = `REC-2026-${String(++recCounter).padStart(5, "0")}`;
    let subtotal = 0, tax = 0;
    const items = list.map((r) => {
      const c = prod[r.sku].cost;
      subtotal += c * r.qty; tax += c * r.qty * 0.19;
      return { productId: prod[r.sku].id, quantity: r.qty, receivedQuantity: r.qty, unitCost: c, taxRate: 19, total: r2(c * r.qty * 1.19) };
    });
    const sObj = suppliersData.find((s) => s.key === supplierKey)!;
    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: O, number: ocNum, supplierId: sup[supplierKey], warehouseId: whMain.id, status: "CLOSED", orderDate: new Date(date.getTime() - sObj.lead * DAY), expectedDate: date,
        subtotal: r2(subtotal), tax: r2(tax), shipping: sObj.shipping, total: r2(subtotal + tax + sObj.shipping), paymentTerms: sObj.creditDays ? `Crédito ${sObj.creditDays} días` : "Contado",
        createdById: admin!.id, createdAt: new Date(date.getTime() - sObj.lead * DAY), items: { create: items },
      },
      include: { items: true },
    });
    const gr = await prisma.goodsReceipt.create({
      data: {
        organizationId: O, number: recNum, purchaseOrderId: po.id, supplierId: sup[supplierKey], warehouseId: whMain.id, receivedAt: date, receivedById: admin!.id, receivedByName: "Carlos Ruiz",
        items: {
          create: po.items.map((it) => {
            const p = PRODUCTS.find((x) => prod[x.sku].id === it.productId)!;
            return {
              purchaseOrderItemId: it.id, productId: it.productId, orderedQuantity: it.quantity, receivedQuantity: it.quantity, acceptedQuantity: it.quantity, unitCost: it.unitCost,
              lotNumber: p.lot ? `L-${recNum.slice(-3)}${p.sku.slice(-2)}` : null, expirationDate: p.lot ? new Date(date.getTime() + 300 * DAY) : null,
            };
          }),
        },
      },
    });
    const amount = r2(subtotal + tax + sObj.shipping);
    const paid = Number(t) < now - 40 * DAY;
    await prisma.accountPayable.create({
      data: {
        organizationId: O, supplierId: sup[supplierKey], purchaseOrderId: po.id, goodsReceiptId: gr.id, documentNumber: `${ocNum} / ${recNum}`, amount,
        paidAmount: paid ? amount : 0, status: paid ? "PAID" : "PENDING", dueDate: new Date(date.getTime() + sObj.creditDays * DAY), createdAt: date,
      },
    });
    if (paid) await prisma.cashMovement.create({ data: { organizationId: O, type: "OUT", amount, concept: `Pago a proveedor ${ocNum}`, referenceType: "PAYABLE", createdAt: new Date(date.getTime() + sObj.creditDays * DAY) } });
    for (const r of list) {
      const p = prod[r.sku];
      events.push({ t: date, sku: r.sku, q: r.qty, type: "PURCHASE_RECEIPT", ref: `${recNum} / ${ocNum}`, refId: gr.id, cost: p.cost, lot: p.lot ? `L-${recNum.slice(-3)}${p.sku.slice(-2)}` : undefined, exp: p.lot ? new Date(date.getTime() + 300 * DAY) : undefined });
    }
  }

  // Pedidos históricos entregados + facturas + pagos
  let pedCounter = 0, cotCounter = 0, fvCounter = 0;
  const groups = [...orderGroups.values()].sort((a, b) => a[0].date.getTime() - b[0].date.getTime());
  for (const g of groups) {
    const customer = customers[g[0].customerIdx];
    const date = g[0].date;
    const isMayor = customer.priceListId === plMayor.id;
    const lines = g.map((s) => {
      const p = prod[s.sku];
      const price = isMayor ? Math.round((p.price * 0.92) / 100) * 100 : p.price;
      const subtotal = r2(price * s.qty);
      const tax = r2(subtotal * 0.19);
      return { productId: p.id, quantity: s.qty, unitPrice: price, taxRate: 19, subtotal, tax, total: r2(subtotal + tax), sku: s.sku, cost: p.cost };
    });
    const subtotal = r2(lines.reduce((s, l) => s + l.subtotal, 0));
    const tax = r2(lines.reduce((s, l) => s + l.tax, 0));
    const cotNum = `COT-2026-${String(++cotCounter).padStart(5, "0")}`;
    const pedNum = `PED-2026-${String(++pedCounter + 700).padStart(5, "0")}`;
    const quote = await prisma.quotation.create({
      data: {
        organizationId: O, number: cotNum, customerId: customer.id, warehouseId: whMain.id, priceListId: customer.priceListId, salespersonName: "Laura Gómez",
        issueDate: new Date(date.getTime() - 2 * 3600000), expirationDate: new Date(date.getTime() + 15 * DAY), createdAt: new Date(date.getTime() - 2 * 3600000),
        subtotal, tax, total: r2(subtotal + tax), status: "CONVERTED",
        items: { create: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: 19, subtotal: l.subtotal, tax: l.tax, total: l.total, availableStockSnapshot: 0 })) },
      },
    });
    const ageDays = (now - date.getTime()) / DAY;
    const status = ageDays < 1 ? "DISPATCHED" : "DELIVERED";
    const order = await prisma.salesOrder.create({
      data: {
        organizationId: O, number: pedNum, quotationId: quote.id, customerId: customer.id, warehouseId: whMain.id, status, subtotal, tax, total: r2(subtotal + tax),
        createdAt: date, confirmedAt: date, dispatchedAt: date,
        items: { create: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, fulfilledQuantity: l.quantity, unitPrice: l.unitPrice, taxRate: 19, unitCost: l.cost, subtotal: l.subtotal, tax: l.tax, total: l.total })) },
      },
    });
    for (const l of lines) events.push({ t: date, sku: l.sku, q: -l.quantity, type: "SALE", ref: pedNum, refId: order.id, cost: l.cost });

    const total = r2(subtotal + tax);
    const due = new Date(date.getTime() + customer.creditDays * DAY);
    // Contado se paga de inmediato; crédito se paga si ya venció hace >5 días (algunos quedan en mora)
    const paid = customer.creditDays === 0 || (due.getTime() < now - 5 * DAY && rnd() > 0.08);
    const inv = await prisma.invoice.create({
      data: {
        organizationId: O, number: `FV-2026-${String(++fvCounter).padStart(5, "0")}`, salesOrderId: order.id, customerId: customer.id, issueDate: date, dueDate: due,
        subtotal, tax, total, paidAmount: paid ? total : 0, status: paid ? "PAID" : "ISSUED",
      },
    });
    if (paid) {
      const payDate = customer.creditDays === 0 ? date : new Date(Math.min(now, due.getTime() - rnd() * 5 * DAY));
      await prisma.payment.create({ data: { organizationId: O, invoiceId: inv.id, amount: total, method: customer.creditDays === 0 ? "Efectivo" : "Transferencia", createdAt: payDate } });
      await prisma.cashMovement.create({ data: { organizationId: O, type: "IN", amount: total, concept: `Pago factura ${inv.number}`, referenceType: "INVOICE", referenceId: inv.id, createdAt: payDate } });
    }
  }
  // Gastos operativos de caja
  for (let d = 28; d >= 1; d -= 7) {
    await prisma.cashMovement.create({ data: { organizationId: O, type: "OUT", amount: 450000, concept: "Gastos de transporte y mensajería", createdAt: new Date(now - d * DAY) } });
  }

  // Cotizaciones históricas no convertidas (vencidas/rechazadas/enviadas)
  for (let i = 0; i < 26; i++) {
    const d = Math.floor(rnd() * 40);
    const customer = pick(customers);
    const items = [pick(PRODUCTS), pick(PRODUCTS), pick(PRODUCTS)].filter((v, idx, a) => a.findIndex((x) => x.sku === v.sku) === idx);
    const lines = items.map((p) => {
      const qty = 5 + Math.floor(rnd() * 30);
      const subtotal = p.price * qty;
      return { productId: prod[p.sku].id, quantity: qty, unitPrice: p.price, taxRate: 19, subtotal, tax: r2(subtotal * 0.19), total: r2(subtotal * 1.19), availableStockSnapshot: 0 };
    });
    const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
    const issue = new Date(now - d * DAY);
    const status = d > 15 ? (rnd() > 0.5 ? "EXPIRED" : "REJECTED") : "SENT";
    await prisma.quotation.create({
      data: {
        organizationId: O, number: `COT-2026-${String(++cotCounter).padStart(5, "0")}`, customerId: customer.id, warehouseId: whMain.id, priceListId: plGeneral.id, salespersonName: "Laura Gómez",
        issueDate: issue, createdAt: issue, expirationDate: new Date(issue.getTime() + 15 * DAY), subtotal, tax: r2(subtotal * 0.19), total: r2(subtotal * 1.19), status,
        items: { create: lines },
      },
    });
  }

  // Escribir kardex en orden cronológico con saldos anteriores/resultantes
  events.sort((a, b) => a.t.getTime() - b.t.getTime());
  for (const e of events) {
    const prev = running[e.sku] ?? 0;
    const res = r2(prev + e.q);
    if (res < 0) throw new Error(`Saldo negativo en ${e.sku}`);
    running[e.sku] = res;
    movements.push({
      organizationId: O, productId: prod[e.sku].id, warehouseId: whMain.id, movementType: e.type, quantity: e.q, previousQuantity: prev, resultingQuantity: res,
      unitCost: e.cost, totalCost: r2(Math.abs(e.q) * e.cost), referenceType: e.type === "SALE" ? "SALES_ORDER" : e.type === "PURCHASE_RECEIPT" ? "GOODS_RECEIPT" : "ADJUSTMENT",
      referenceId: e.refId, referenceNumber: e.ref, userId: admin!.id, userName: e.type === "SALE" ? "Laura Gómez" : "Carlos Ruiz", notes: e.notes, lotNumber: e.lot, expirationDate: e.exp, createdAt: e.t,
    });
  }
  for (let i = 0; i < movements.length; i += 500) await prisma.inventoryMovement.createMany({ data: movements.slice(i, i + 500) });
  for (const p of PRODUCTS) {
    if (running[p.sku] !== p.final) throw new Error(`Saldo final no cuadra en ${p.sku}: ${running[p.sku]} vs ${p.final}`);
    await prisma.inventoryBalance.create({ data: { organizationId: O, warehouseId: whMain.id, productId: prod[p.sku].id, onHand: p.final } });
  }
  // Algo de stock en exhibición
  const whExh = await prisma.warehouse.findFirstOrThrow({ where: { organizationId: O, code: "BOD-02" } });
  for (const sku of ["LIM001", "LIM006", "LIM007"]) {
    await prisma.inventoryBalance.create({ data: { organizationId: O, warehouseId: whExh.id, productId: prod[sku].id, onHand: 6 } });
    await prisma.inventoryMovement.create({
      data: { organizationId: O, productId: prod[sku].id, warehouseId: whExh.id, movementType: "POSITIVE_ADJUSTMENT", quantity: 6, previousQuantity: 0, resultingQuantity: 6, unitCost: prod[sku].cost, totalCost: 6 * prod[sku].cost, referenceNumber: "INV-INICIAL", notes: "Inventario inicial exhibición", createdAt: new Date(now - 95 * DAY) },
    });
  }

  await prisma.counter.createMany({
    data: [
      { organizationId: O, key: "COT-2026", value: Math.max(cotCounter, 122) },
      { organizationId: O, key: "PED-2026", value: pedCounter + 700 },
      { organizationId: O, key: "OC-2026", value: 157 },
      { organizationId: O, key: "REC-2026", value: recCounter },
      { organizationId: O, key: "FV-2026", value: fvCounter },
      { organizationId: O, key: "AJ-2026", value: 1 },
    ],
  });

  console.log("→ Estado actual con servicios reales (reservas, faltantes, OC en tránsito)…");
  const [hotel, clinica, fogon, colegio, nova] = customers;
  const P = (sku: string, q: number, c = customers[1]) => ({ productId: prod[sku].id, quantity: q, unitPrice: c.priceListId === plMayor.id ? Math.round((prod[sku].price * 0.92) / 100) * 100 : prod[sku].price, discountPct: 0 });

  const q1 = await saveQuotation(ctx, { customerId: clinica.id, priceListId: clinica.priceListId, warehouseId: whMain.id, validityDays: 15, items: [P("LIM001", 10, clinica), P("LIM002", 8, clinica), P("LIM003", 15, clinica), P("LIM005", 6, clinica), P("LIM006", 10, clinica), P("LIM007", 20, clinica)] }, "SENT");
  await convertQuotationToOrder(ctx, q1.id);
  const q2 = await saveQuotation(ctx, { customerId: fogon.id, priceListId: fogon.priceListId, warehouseId: whMain.id, validityDays: 15, items: [P("LIM004", 5, fogon), P("CAF003", 20, fogon), P("LIM010", 10, fogon)] }, "SENT");
  await convertQuotationToOrder(ctx, q2.id);
  const q3 = await saveQuotation(ctx, { customerId: colegio.id, priceListId: colegio.priceListId, warehouseId: whMain.id, validityDays: 15, items: [P("PAP001", 12, colegio), P("PAP004", 10, colegio)] }, "SENT");
  await convertQuotationToOrder(ctx, q3.id);
  await saveQuotation(ctx, { customerId: hotel.id, priceListId: hotel.priceListId, warehouseId: whMain.id, validityDays: 15, notes: "Entrega en recepción del hotel", items: [P("LIM001", 30, hotel), P("LIM002", 20, hotel), P("LIM003", 50, hotel)] }, "DRAFT");
  const q5 = await saveQuotation(ctx, { customerId: nova.id, priceListId: nova.priceListId, warehouseId: whMain.id, validityDays: 15, items: [P("CAF001", 6, nova), P("CAF002", 10, nova), P("PAP001", 5, nova)] }, "SENT");
  await setQuotationStatus(ctx, q5.id, "SENT");

  // OC en tránsito (como en el mockup: OC-2026-00158 de Distribuciones Alfa)
  const po = await createPurchaseOrder(ctx, { supplierId: sup.alfa, warehouseId: whMain.id, items: [{ productId: prod.LIM008.id, quantity: 40, unitCost: 5500 }, { productId: prod.LIM009.id, quantity: 25, unitCost: 9500 }], notes: "Reposición mensual" });
  await transitionPurchaseOrder(ctx, po.id, "SENT");
  await transitionPurchaseOrder(ctx, po.id, "CONFIRMED");
  await transitionPurchaseOrder(ctx, po.id, "IN_TRANSIT");
  const po2 = await createPurchaseOrder(ctx, { supplierId: sup.papeleria, warehouseId: whMain.id, items: [{ productId: prod.PAP002.id, quantity: 20, unitCost: 7650 }] });
  await transitionPurchaseOrder(ctx, po2.id, "SENT");

  await prisma.notification.createMany({
    data: [
      { organizationId: O, type: "OUT_OF_STOCK", title: "Productos agotados", message: "Guantes de nitrilo, Ambientador, Vasos desechables y Cinta adhesiva están agotados.", link: "/inventario/alertas" },
      { organizationId: O, type: "PO_UNCONFIRMED", title: "OC sin confirmar", message: "La OC enviada a Papelería Central aún no ha sido confirmada por el proveedor.", link: "/compras/ordenes" },
    ],
  });

  const counts = {
    productos: await prisma.product.count(),
    movimientos: await prisma.inventoryMovement.count(),
    pedidos: await prisma.salesOrder.count(),
    cotizaciones: await prisma.quotation.count(),
    facturas: await prisma.invoice.count(),
  };
  console.log("✔ Seed completo", counts);
  console.log(`  Usuario: admin@latinsoft.co / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
