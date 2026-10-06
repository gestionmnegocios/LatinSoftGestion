/* Herramientas controladas del Copiloto (Arq. §39-40).
 * El modelo nunca accede a tablas: llama estas funciones y el backend calcula los números.
 * Nivel 1 = lectura (sin confirmación). Nivel 2 = borradores (no ejecutan nada crítico). */
import { prisma, round2, type Ctx } from "../db";
import { getStockRows } from "../services/inventory";
import { calculateRequirements, createRequirement } from "../services/procurement";
import { saveQuotation } from "../services/sales";

const DAY = 86400000;
const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");

function norm(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type ToolResult = { data: unknown; summary: string; link?: { label: string; href: string } };

export async function getInventorySummary(ctx: Ctx): Promise<ToolResult> {
  const rows = await getStockRows(ctx.orgId, ctx.warehouseId);
  const valued = rows.reduce((s, r) => s + r.onHand * r.averageCost, 0);
  const low = rows.filter((r) => r.status === "LOW");
  const out = rows.filter((r) => r.status === "OUT_OF_STOCK");
  const over = rows.filter((r) => r.status === "OVERSTOCK");
  const stale = await getStaleProducts(ctx, 90);
  const staleValue = (stale.data as { value: number }[]).reduce((s, x) => s + x.value, 0);
  const data = {
    products: rows.length,
    valued_inventory: round2(valued),
    low_stock: low.map((r) => ({ name: r.name, available: r.available, minimum: r.minimumStock })),
    out_of_stock: out.map((r) => r.name),
    overstock: over.map((r) => ({ name: r.name, on_hand: r.onHand, maximum: r.maximumStock })),
    immobilized_value_90d: round2(staleValue),
  };
  return {
    data,
    summary: `Inventario valorizado ${money(valued)} en ${rows.length} productos. ${low.length} con stock bajo, ${out.length} agotados, ${over.length} con sobreinventario. ${money(staleValue)} inmovilizados sin ventas en 90 días.`,
    link: { label: "Ver alertas de inventario", href: "/inventario/alertas" },
  };
}

export async function getLowStockProducts(ctx: Ctx, days = 7): Promise<ToolResult> {
  const rows = await getStockRows(ctx.orgId, ctx.warehouseId);
  const since = new Date(Date.now() - 30 * DAY);
  const sales = await prisma.inventoryMovement.groupBy({
    by: ["productId"],
    where: { organizationId: ctx.orgId, warehouseId: ctx.warehouseId, movementType: "SALE", createdAt: { gte: since } },
    _sum: { quantity: true },
  });
  const rate = new Map(sales.map((s) => [s.productId, Math.abs(s._sum.quantity ?? 0) / 30]));
  const list = rows
    .map((r) => {
      const daily = rate.get(r.productId) ?? 0;
      const daysLeft = daily > 0 ? r.available / daily : r.available > 0 ? 999 : 0;
      return { name: r.name, sku: r.sku, available: r.available, minimum: r.minimumStock, incoming: r.incoming, daily_sales: round2(daily), days_of_coverage: round2(daysLeft), status: r.status };
    })
    .filter((r) => r.status === "OUT_OF_STOCK" || r.status === "LOW" || r.days_of_coverage <= days)
    .sort((a, b) => a.days_of_coverage - b.days_of_coverage);
  const soon = list.filter((r) => r.available > 0 && r.days_of_coverage <= days);
  return {
    data: list,
    summary: `${list.length} productos requieren atención; ${soon.length} podrían agotarse en los próximos ${days} días y ${list.filter((r) => r.status === "OUT_OF_STOCK").length} ya están agotados.`,
    link: { label: "Ver necesidades de compra", href: "/compras/necesidades" },
  };
}

export async function getStaleProducts(ctx: Ctx, days = 90): Promise<ToolResult> {
  const since = new Date(Date.now() - days * DAY);
  const sold = await prisma.inventoryMovement.findMany({
    where: { organizationId: ctx.orgId, movementType: "SALE", createdAt: { gte: since } },
    select: { productId: true },
    distinct: ["productId"],
  });
  const soldSet = new Set(sold.map((s) => s.productId));
  const rows = await getStockRows(ctx.orgId);
  // Productos sin venta en el periodo, o con rotación muy baja frente a su existencia (> 180 días de cobertura)
  const salesAgg = await prisma.inventoryMovement.groupBy({
    by: ["productId"],
    where: { organizationId: ctx.orgId, movementType: "SALE", createdAt: { gte: since } },
    _sum: { quantity: true },
  });
  const qty = new Map(salesAgg.map((s) => [s.productId, Math.abs(s._sum.quantity ?? 0)]));
  const list = rows
    .filter((r) => r.onHand > 0)
    .map((r) => {
      const sold = qty.get(r.productId) ?? 0;
      const coverageDays = sold > 0 ? (r.onHand / (sold / days)) : Infinity;
      return { name: r.name, sku: r.sku, on_hand: r.onHand, sold_in_period: sold, coverage_days: Number.isFinite(coverageDays) ? Math.round(coverageDays) : null, value: round2(r.onHand * r.averageCost), no_sales: !soldSet.has(r.productId) };
    })
    .filter((r) => r.no_sales || (r.coverage_days ?? 9999) > 180)
    .sort((a, b) => b.value - a.value);
  return {
    data: list,
    summary: list.length
      ? `${list.length} productos con baja o nula rotación en ${days} días, por ${money(list.reduce((s, x) => s + x.value, 0))} inmovilizados.`
      : `Todos los productos tuvieron movimiento en los últimos ${days} días.`,
  };
}

export async function getTopMarginProducts(ctx: Ctx, limit = 8): Promise<ToolResult> {
  const products = await prisma.product.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" } });
  const list = products
    .filter((p) => p.salePrice > 0)
    .map((p) => ({ name: p.name, sku: p.sku, price: p.salePrice, average_cost: p.averageCost, margin_pct: round2(((p.salePrice - p.averageCost) / p.salePrice) * 100), unit_margin: round2(p.salePrice - p.averageCost) }))
    .sort((a, b) => b.margin_pct - a.margin_pct)
    .slice(0, limit);
  return { data: list, summary: `Mayor margen: ${list.slice(0, 3).map((p) => `${p.name} (${p.margin_pct.toFixed(1)}%)`).join(", ")}.` };
}

export async function getSalesSummary(ctx: Ctx, days = 30): Promise<ToolResult> {
  const since = new Date(Date.now() - days * DAY);
  const orders = await prisma.salesOrder.findMany({
    where: { organizationId: ctx.orgId, createdAt: { gte: since }, status: { not: "CANCELLED" } },
    include: { items: { include: { product: true } }, customer: true },
  });
  const total = orders.reduce((s, o) => s + o.subtotal, 0);
  const cost = orders.reduce((s, o) => s + o.items.reduce((a, i) => a + i.unitCost * i.quantity, 0), 0);
  const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
  const byCustomer = new Map<string, number>();
  for (const o of orders) {
    byCustomer.set(o.customer.name, (byCustomer.get(o.customer.name) ?? 0) + o.subtotal);
    for (const i of o.items) {
      const e = byProduct.get(i.productId) ?? { name: i.product.name, qty: 0, revenue: 0 };
      e.qty += i.quantity; e.revenue += i.subtotal;
      byProduct.set(i.productId, e);
    }
  }
  const top = [...byProduct.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  const topCustomers = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, v]) => ({ name, revenue: round2(v) }));
  return {
    data: { days, orders: orders.length, revenue_before_tax: round2(total), gross_margin: round2(total - cost), gross_margin_pct: total ? round2(((total - cost) / total) * 100) : 0, average_ticket: orders.length ? round2(total / orders.length) : 0, top_products: top, top_customers: topCustomers },
    summary: `Últimos ${days} días: ${orders.length} pedidos por ${money(total)} (antes de IVA), margen bruto ${total ? (((total - cost) / total) * 100).toFixed(1) : 0}%. Más vendido: ${top[0]?.name ?? "—"}.`,
  };
}

export async function getProductStock(ctx: Ctx, query: string): Promise<ToolResult> {
  const rows = await getStockRows(ctx.orgId, ctx.warehouseId);
  const q = norm(query);
  const found = rows.filter((r) => norm(r.name).includes(q) || norm(r.sku).includes(q) || q.split(/\s+/).every((w) => norm(r.name).includes(w)));
  return {
    data: found.map((r) => ({ name: r.name, sku: r.sku, on_hand: r.onHand, reserved: r.reserved, available: r.available, incoming: r.incoming, projected: r.projected, status: r.status })),
    summary: found.length ? found.map((r) => `${r.name}: físico ${r.onHand}, comprometido ${r.reserved}, disponible ${r.available}, en tránsito ${r.incoming}`).join(". ") : `No encontré productos que coincidan con "${query}".`,
  };
}

export async function calculatePurchaseRequirement(ctx: Ctx, horizonDays = 30): Promise<ToolResult> {
  const rows = await calculateRequirements(ctx.orgId, ctx.warehouseId, horizonDays);
  const total = rows.reduce((s, r) => s + r.estimatedCost, 0);
  return {
    data: { horizon_days: horizonDays, estimated_total: round2(total), items: rows.map((r) => ({ name: r.name, available: r.available, shortage_from_orders: r.shortage, incoming: r.incoming, suggested_quantity: r.suggested, reason: r.reason, estimated_cost: r.estimatedCost, preferred_supplier: r.preferredSupplier })) },
    summary: `Encontré ${rows.length} productos que necesitan reposición para cubrir ${horizonDays} días. Compra recomendada: ${money(total)}.`,
    link: { label: "Revisar propuesta", href: `/compras/necesidades?h=${horizonDays}` },
  };
}

export async function getSupplierOptions(ctx: Ctx, productQuery?: string): Promise<ToolResult> {
  const sps = await prisma.supplierProduct.findMany({
    where: { organizationId: ctx.orgId, status: "ACTIVE" },
    include: { supplier: true, product: true },
  });
  const q = productQuery ? norm(productQuery) : "";
  const filtered = q ? sps.filter((s) => norm(s.product.name).includes(q) || norm(s.product.sku).includes(q)) : sps;
  const bySupplier = new Map<string, { name: string; products: number; credit_days: number; lead_time: number; shipping: number; rating: number; avg_price_index: number[] }>();
  for (const s of filtered) {
    const e = bySupplier.get(s.supplierId) ?? { name: s.supplier.tradeName ?? s.supplier.legalName, products: 0, credit_days: s.supplier.creditDays, lead_time: s.supplier.averageLeadTime, shipping: s.supplier.shippingCost, rating: s.supplier.fulfillmentRating, avg_price_index: [] };
    e.products++;
    e.avg_price_index.push(s.price / (s.product.averageCost || s.price));
    bySupplier.set(s.supplierId, e);
  }
  const list = [...bySupplier.values()].map((e) => ({ ...e, avg_price_index: round2(e.avg_price_index.reduce((a, b) => a + b, 0) / e.avg_price_index.length) }));
  const offers = q ? filtered.map((s) => ({ supplier: s.supplier.tradeName ?? s.supplier.legalName, product: s.product.name, price: s.price, lead_time_days: s.leadTimeDays, min_qty: s.minimumOrderQuantity })) : undefined;
  return {
    data: { suppliers: list, offers },
    summary: list.map((s) => `${s.name}: ${s.products} productos, índice de precio ${s.avg_price_index}, entrega ${s.lead_time} días, crédito ${s.credit_days} días, transporte ${money(s.shipping)}, cumplimiento ${s.rating}/5`).join(". "),
    link: { label: "Abrir comparador desde necesidades", href: "/compras/necesidades" },
  };
}

export async function createQuoteDraft(ctx: Ctx, customerQuery: string, items: { product: string; quantity: number }[]): Promise<ToolResult> {
  const customers = await prisma.customer.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" } });
  const cq = norm(customerQuery);
  const customer = customers.find((c) => norm(c.name).includes(cq)) ?? customers.find((c) => cq.split(/\s+/).some((w) => w.length > 3 && norm(c.name).includes(w)));
  if (!customer) return { data: { error: "customer_not_found" }, summary: `No encontré el cliente "${customerQuery}".` };
  const products = await prisma.product.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" }, include: { prices: true } });
  const lines = [];
  const missing: string[] = [];
  for (const it of items) {
    const pq = norm(it.product).replace(/s\b/g, "");
    const p = products.find((x) => norm(x.name).includes(pq)) ?? products.find((x) => pq.split(/\s+/).some((w) => w.length > 3 && norm(x.name).includes(w)));
    if (!p) { missing.push(it.product); continue; }
    const listPrice = p.prices.find((pr) => pr.priceListId === customer.priceListId)?.price ?? p.salePrice;
    lines.push({ productId: p.id, quantity: it.quantity, unitPrice: listPrice, discountPct: 0 });
  }
  if (!lines.length) return { data: { error: "products_not_found", missing }, summary: `No encontré los productos: ${missing.join(", ")}.` };
  const q = await saveQuotation(ctx, { customerId: customer.id, priceListId: customer.priceListId, warehouseId: ctx.warehouseId, validityDays: 15, items: lines }, "DRAFT");
  const full = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id }, include: { items: { include: { product: true } } } });
  const shortages = full.items.filter((i) => i.availableStockSnapshot < i.quantity).map((i) => `${i.product.name}: faltan ${round2(i.quantity - Math.max(0, i.availableStockSnapshot))}`);
  return {
    data: { number: q.number, customer: customer.name, total: q.total, shortages, missing },
    summary: `Creé la cotización borrador ${q.number} para ${customer.name} por ${money(q.total)} (IVA incluido).${shortages.length ? ` Atención: ${shortages.join("; ")}.` : " Hay disponibilidad completa."}${missing.length ? ` No encontré: ${missing.join(", ")}.` : ""} Revísala antes de enviarla.`,
    link: { label: `Revisar ${q.number}`, href: `/ventas/cotizaciones/${q.id}` },
  };
}

export async function createPurchaseDraft(ctx: Ctx, horizonDays = 30): Promise<ToolResult> {
  const rows = await calculateRequirements(ctx.orgId, ctx.warehouseId, horizonDays);
  if (!rows.length) return { data: { items: 0 }, summary: "No hay productos que requieran compra en este momento." };
  const req = await createRequirement(ctx, ctx.warehouseId, rows.map((r) => ({ productId: r.productId, quantity: r.suggested })), horizonDays);
  const total = rows.reduce((s, r) => s + r.estimatedCost, 0);
  return {
    data: { requirement: req.number, items: rows.length, estimated_total: round2(total) },
    summary: `Creé la necesidad de compra ${req.number} con ${rows.length} productos (≈ ${money(total)}). El siguiente paso es comparar proveedores; ninguna orden se envía sin tu aprobación.`,
    link: { label: "Comparar proveedores", href: `/compras/comparador/${req.id}` },
  };
}
