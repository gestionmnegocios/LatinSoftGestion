import { prisma, DomainError, requirePermission, round2, type Ctx } from "../db";
import { getStockRows, type StockStatus } from "./inventory";
import { audit, nextNumber } from "./common";

export type RequirementRow = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  minimumStock: number;
  safetyStock: number;
  avgDailySales: number;
  expectedDemand: number;
  shortage: number;
  needed: number;
  suggested: number;
  reason: "OUT_OF_STOCK" | "SALES_ORDER" | "LOW_STOCK" | "FORECAST";
  status: StockStatus;
  unitCost: number;
  estimatedCost: number;
  preferredSupplier: string | null;
};

const DAY = 86400000;

/**
 * Motor de reposición (PRD §11, Arq. §20) — determinístico, la IA solo lo interpreta.
 * net = demanda prevista + stock seguridad + faltantes de pedidos − disponible − en tránsito
 * con piso en el stock mínimo y redondeo a la cantidad mínima del proveedor preferido.
 */
export async function calculateRequirements(orgId: string, warehouseId: string, horizonDays = 30): Promise<RequirementRow[]> {
  const rows = await getStockRows(orgId, warehouseId);
  const since = new Date(Date.now() - 90 * DAY);
  const sales = await prisma.inventoryMovement.groupBy({
    by: ["productId"],
    where: { organizationId: orgId, warehouseId, movementType: "SALE", createdAt: { gte: since } },
    _sum: { quantity: true },
  });
  const salesMap = new Map(sales.map((s) => [s.productId, Math.abs(s._sum.quantity ?? 0)]));

  const openItems = await prisma.salesOrderItem.findMany({
    where: { salesOrder: { organizationId: orgId, warehouseId, status: { in: ["CONFIRMED", "PREPARING", "READY", "PARTIAL"] } } },
  });
  const shortageMap = new Map<string, number>();
  for (const it of openItems) {
    const s = it.quantity - it.reservedQuantity - it.fulfilledQuantity;
    if (s > 0) shortageMap.set(it.productId, (shortageMap.get(it.productId) ?? 0) + s);
  }

  const sps = await prisma.supplierProduct.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    include: { supplier: true },
  });

  const out: RequirementRow[] = [];
  for (const r of rows) {
    const avgDaily = (salesMap.get(r.productId) ?? 0) / 90;
    const expectedDemand = Math.ceil(avgDaily * horizonDays);
    const shortage = shortageMap.get(r.productId) ?? 0;
    const formula = expectedDemand + r.safetyStock + shortage - r.available - r.incoming;
    const floorToMin = r.minimumStock + shortage - r.available - r.incoming;
    let net = Math.max(formula, floorToMin);
    // Solo se recomienda compra si hay faltante o se perfora el punto mínimo.
    const triggers = shortage > 0 || r.available <= r.minimumStock || r.available + r.incoming < expectedDemand * 0.5;
    if (!triggers || net <= 0) continue;

    const options = sps.filter((s) => s.productId === r.productId);
    const preferred = options.find((o) => o.isPreferred) ?? options.sort((a, b) => a.price - b.price)[0];
    if (preferred && preferred.minimumOrderQuantity > 1) {
      net = Math.ceil(net / preferred.minimumOrderQuantity) * preferred.minimumOrderQuantity;
    }
    net = Math.ceil(net);
    const unitCost = preferred?.price ?? (r.averageCost || 0);
    const reason: RequirementRow["reason"] =
      r.available <= 0 ? "OUT_OF_STOCK" : shortage > 0 ? "SALES_ORDER" : r.available <= r.minimumStock ? "LOW_STOCK" : "FORECAST";

    out.push({
      productId: r.productId,
      sku: r.sku,
      name: r.name,
      category: r.category,
      onHand: r.onHand,
      reserved: r.reserved,
      available: r.available,
      incoming: r.incoming,
      minimumStock: r.minimumStock,
      safetyStock: r.safetyStock,
      avgDailySales: round2(avgDaily),
      expectedDemand,
      shortage,
      needed: round2(net + r.available + r.incoming),
      suggested: net,
      reason,
      status: r.status,
      unitCost,
      estimatedCost: round2(net * unitCost),
      preferredSupplier: preferred?.supplier.tradeName ?? preferred?.supplier.legalName ?? null,
    });
  }
  const order = { OUT_OF_STOCK: 0, SALES_ORDER: 1, LOW_STOCK: 2, FORECAST: 3 };
  return out.sort((a, b) => order[a.reason] - order[b.reason] || b.estimatedCost - a.estimatedCost);
}

export async function createRequirement(
  ctx: Ctx,
  warehouseId: string,
  items: { productId: string; quantity: number }[],
  horizonDays = 30,
) {
  requirePermission(ctx, "purchase.create");
  const chosen = items.filter((i) => i.quantity > 0);
  if (!chosen.length) throw new DomainError("Seleccione al menos un producto con cantidad a comprar.");
  const calc = await calculateRequirements(ctx.orgId, warehouseId, horizonDays);
  const calcMap = new Map(calc.map((c) => [c.productId, c]));
  return prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "NEC", 4);
    const req = await tx.purchaseRequirement.create({
      data: { organizationId: ctx.orgId, number, warehouseId, createdById: ctx.userId },
    });
    for (const i of chosen) {
      const c = calcMap.get(i.productId);
      const bal = await tx.inventoryBalance.findUnique({ where: { warehouseId_productId: { warehouseId, productId: i.productId } } });
      await tx.purchaseRequirementItem.create({
        data: {
          purchaseRequirementId: req.id,
          productId: i.productId,
          currentStock: bal?.onHand ?? 0,
          reservedStock: bal?.reserved ?? 0,
          incomingStock: bal?.incoming ?? 0,
          suggestedQuantity: c?.suggested ?? 0,
          approvedQuantity: i.quantity,
          reason: c ? c.reason : "MANUAL",
        },
      });
    }
    await audit(tx, ctx, "purchase_requirement.create", "PurchaseRequirement", req.id, undefined, { number, items: chosen });
    return req;
  });
}

// ───────────────────────── Comparador ─────────────────────────

export const SCORE_WEIGHTS = { price: 0.4, delivery: 0.25, fulfillment: 0.15, credit: 0.1, availability: 0.1 };

export type SupplierOption = {
  supplierId: string;
  name: string;
  coverage: number; // 0..1 sobre unidades requeridas
  coveredLines: number;
  totalLines: number;
  productsTotal: number;
  discountTotal: number;
  shipping: number;
  total: number; // productos − descuento + transporte (antes de IVA)
  leadTime: number;
  creditDays: number;
  paymentTerms: string;
  rating: number;
  score: number;
  lines: { productId: string; name: string; required: number; quantity: number; unitPrice: number; discountPct: number; subtotal: number }[];
  missing: string[];
};

export type Comparison = {
  requirement: { id: string; number: string; warehouseId: string; status: string };
  items: { productId: string; name: string; sku: string; quantity: number }[];
  options: SupplierOption[];
  recommendedId: string | null;
  cheapestId: string | null;
  explanation: string;
  optimized: {
    total: number;
    savings: number;
    reason: "coverage" | "savings";
    groups: { supplierId: string; name: string; lines: SupplierOption["lines"]; shipping: number; total: number; leadTime: number }[];
    unassigned: string[];
    explanation: string;
  } | null;
};

const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");

export async function compareSuppliers(orgId: string, requirementId: string): Promise<Comparison> {
  const req = await prisma.purchaseRequirement.findFirstOrThrow({
    where: { id: requirementId, organizationId: orgId },
    include: { items: { include: { product: true } } },
  });
  const items = req.items
    .filter((i) => i.approvedQuantity > 0)
    .map((i) => ({ productId: i.productId, name: i.product.name, sku: i.product.sku, quantity: i.approvedQuantity }));
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);

  const suppliers = await prisma.supplier.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    include: { products: { where: { productId: { in: items.map((i) => i.productId) }, status: "ACTIVE" } } },
  });

  const options: SupplierOption[] = [];
  for (const s of suppliers) {
    const lines: SupplierOption["lines"] = [];
    const missing: string[] = [];
    let coveredUnits = 0, productsTotal = 0, discountTotal = 0, leadTime = 0;
    for (const it of items) {
      const sp = s.products.find((p) => p.productId === it.productId);
      if (!sp || sp.availableQuantity <= 0) { missing.push(it.name); continue; }
      const qty = Math.min(it.quantity, sp.availableQuantity);
      if (qty < it.quantity) missing.push(`${it.name} (solo ${qty})`);
      const gross = qty * sp.price;
      const disc = gross * (sp.discountPct / 100);
      coveredUnits += qty;
      productsTotal += gross;
      discountTotal += disc;
      leadTime = Math.max(leadTime, sp.leadTimeDays);
      lines.push({ productId: it.productId, name: it.name, required: it.quantity, quantity: qty, unitPrice: sp.price, discountPct: sp.discountPct, subtotal: round2(gross - disc) });
    }
    if (!lines.length) continue;
    options.push({
      supplierId: s.id,
      name: s.tradeName ?? s.legalName,
      coverage: totalUnits ? coveredUnits / totalUnits : 0,
      coveredLines: lines.length,
      totalLines: items.length,
      productsTotal: round2(productsTotal),
      discountTotal: round2(discountTotal),
      shipping: s.shippingCost,
      total: round2(productsTotal - discountTotal + s.shippingCost),
      leadTime: leadTime || s.averageLeadTime,
      creditDays: s.creditDays,
      paymentTerms: s.paymentTerms,
      rating: s.fulfillmentRating,
      score: 0,
      lines,
      missing,
    });
  }

  // Puntaje ponderado (Arq. §25). El precio se normaliza por unidad cubierta
  // para no premiar a quien es "barato" porque no cubre la necesidad.
  if (options.length) {
    const unitCost = (o: SupplierOption) => o.total / Math.max(1, o.coverage * totalUnits);
    const minUnit = Math.min(...options.map(unitCost));
    const minLead = Math.min(...options.map((o) => o.leadTime));
    const maxCredit = Math.max(1, ...options.map((o) => o.creditDays));
    for (const o of options) {
      const s =
        SCORE_WEIGHTS.price * (minUnit / unitCost(o)) +
        SCORE_WEIGHTS.delivery * (Math.max(1, minLead) / Math.max(1, o.leadTime)) +
        SCORE_WEIGHTS.fulfillment * (o.rating / 5) +
        SCORE_WEIGHTS.credit * (o.creditDays / maxCredit) +
        SCORE_WEIGHTS.availability * o.coverage;
      // Una cobertura incompleta obliga a una segunda compra: se penaliza.
      o.score = round2(s * 100 * (o.coverage >= 0.999 ? 1 : 0.85));
    }
    options.sort((a, b) => b.score - a.score);
  }

  const recommended = options[0] ?? null;
  const perUnit = (o: SupplierOption) => o.total / Math.max(1, o.coverage * totalUnits);
  const cheapest = [...options].sort((a, b) => perUnit(a) - perUnit(b))[0] ?? null;
  const pctText = (n: number) => `${Math.abs(n).toFixed(1).replace(".", ",")}%`;
  let explanation = "No hay proveedores registrados para estos productos.";
  if (recommended) {
    const parts = [`${recommended.name} recomendado (puntaje ${recommended.score}).`];
    if (cheapest && cheapest.supplierId !== recommended.supplierId) {
      // Se compara el precio solo sobre los productos que ambos ofrecen (canasta comparable).
      const common = recommended.lines.filter((l) => cheapest.lines.some((c) => c.productId === l.productId && c.quantity === l.quantity));
      const recSub = common.reduce((a, l) => a + l.subtotal, 0);
      const chSub = common.reduce((a, l) => a + cheapest.lines.find((c) => c.productId === l.productId)!.subtotal, 0);
      const why: string[] = [];
      if (recommended.coverage > cheapest.coverage) why.push(`cubre el ${Math.round(recommended.coverage * 100)}% de la necesidad frente al ${Math.round(cheapest.coverage * 100)}%`);
      if (recommended.leadTime < cheapest.leadTime) why.push(`entrega ${cheapest.leadTime - recommended.leadTime} día(s) antes`);
      if (recommended.creditDays > cheapest.creditDays) why.push(`ofrece crédito a ${recommended.creditDays} días`);
      if (recommended.shipping < cheapest.shipping) why.push(recommended.shipping === 0 ? "incluye el transporte" : "cobra menos transporte");
      if (recommended.rating > cheapest.rating) why.push(`tiene mejor historial de cumplimiento (${recommended.rating} vs ${cheapest.rating})`);
      if (common.length && chSub > 0) {
        const diff = ((recSub - chSub) / chSub) * 100;
        parts.push(`En los productos que ambos ofrecen, su precio es ${pctText(diff)} ${diff >= 0 ? "superior" : "inferior"} al de ${cheapest.name}` + (why.length ? `, pero ${why.join(", ")}.` : "."));
      } else if (why.length) {
        parts.push(`Frente a ${cheapest.name}: ${why.join(", ")}.`);
      }
    } else {
      parts.push(`Además tiene el menor costo por unidad cubierta (${money(recommended.total)} en total).`);
    }
    if (recommended.coverage < 0.999) parts.push(`No cubre: ${recommended.missing.join(", ")}.`);
    explanation = parts.join(" ");
  }

  // Compra optimizada multiproveedor (PRD §14): mejor proveedor por línea (costo + penalización por días),
  // luego se consolidan grupos cuando ahorrar un transporte compensa la diferencia de precio.
  let optimized: Comparison["optimized"] = null;
  const bestFull = options.filter((o) => o.coverage >= 0.999).sort((a, b) => a.total - b.total)[0] ?? null;
  if (options.length > 1) {
    const groups = new Map<string, { o: SupplierOption; lines: SupplierOption["lines"] }>();
    const unassigned: string[] = [];
    for (const it of items) {
      let best: { o: SupplierOption; line: SupplierOption["lines"][number]; cost: number } | null = null;
      for (const o of options) {
        const line = o.lines.find((l) => l.productId === it.productId && l.quantity >= it.quantity);
        if (!line) continue;
        const cost = line.subtotal * (1 + o.leadTime * 0.005);
        if (!best || cost < best.cost) best = { o, line, cost };
      }
      if (!best) { unassigned.push(it.name); continue; }
      const g = groups.get(best.o.supplierId) ?? { o: best.o, lines: [] };
      g.lines.push(best.line);
      groups.set(best.o.supplierId, g);
    }
    let merged = true;
    while (merged && groups.size > 1) {
      merged = false;
      for (const [gid, g] of groups) {
        for (const [hid, h] of groups) {
          if (gid === hid) continue;
          const moved = g.lines.map((l) => h.o.lines.find((x) => x.productId === l.productId && x.quantity >= l.quantity));
          if (moved.some((m) => !m)) continue;
          const delta = moved.reduce((a, m) => a + m!.subtotal, 0) - g.lines.reduce((a, l) => a + l.subtotal, 0) - g.o.shipping;
          if (delta < 0) { h.lines.push(...(moved as SupplierOption["lines"])); groups.delete(gid); merged = true; break; }
        }
        if (merged) break;
      }
    }
    const gs = [...groups.values()].map((g) => {
      const sub = g.lines.reduce((s, l) => s + l.subtotal, 0);
      return { supplierId: g.o.supplierId, name: g.o.name, lines: g.lines, shipping: g.o.shipping, total: round2(sub + g.o.shipping), leadTime: g.o.leadTime };
    });
    const total = round2(gs.reduce((s, g) => s + g.total, 0));
    if (gs.length > 1 && !unassigned.length && (!bestFull || total < bestFull.total)) {
      const savings = bestFull ? round2(bestFull.total - total) : 0;
      optimized = {
        total,
        savings,
        reason: bestFull ? "savings" : "coverage",
        groups: gs,
        unassigned,
        explanation: bestFull
          ? `Dividir la compra entre ${gs.map((g) => g.name).join(" y ")} ahorra ${money(savings)} frente a comprar todo a ${bestFull.name}, incluso pagando ${gs.length} transportes.`
          : `Ningún proveedor cubre toda la necesidad. Dividiendo la compra entre ${gs.map((g) => `${g.name} (${g.lines.length} producto${g.lines.length === 1 ? "" : "s"})`).join(" y ")} se cubre el 100% por ${money(total)}, con entrega en máximo ${Math.max(...gs.map((g) => g.leadTime))} días.`,
      };
      if (!bestFull) explanation = `Ningún proveedor cubre el 100% de los productos; se recomienda la compra combinada. ${explanation}`;
    }
  }

  return {
    requirement: { id: req.id, number: req.number, warehouseId: req.warehouseId, status: req.status },
    items,
    options,
    recommendedId: recommended?.supplierId ?? null,
    cheapestId: cheapest?.supplierId ?? null,
    explanation,
    optimized,
  };
}

/** Genera OC en borrador a partir de la comparación (decisión humana final). */
export async function createOrdersFromComparison(ctx: Ctx, requirementId: string, choice: string) {
  requirePermission(ctx, "purchase.create");
  const cmp = await compareSuppliers(ctx.orgId, requirementId);
  if (cmp.requirement.status !== "OPEN") throw new DomainError("Esta necesidad ya generó órdenes de compra.");
  let groups: { supplierId: string; lines: SupplierOption["lines"] }[];
  if (choice === "optimized") {
    if (!cmp.optimized) throw new DomainError("No hay propuesta optimizada disponible.");
    groups = cmp.optimized.groups;
  } else {
    const o = cmp.options.find((x) => x.supplierId === choice);
    if (!o) throw new DomainError("Proveedor no válido para esta necesidad.");
    groups = [{ supplierId: o.supplierId, lines: o.lines }];
  }
  return prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const g of groups) {
      const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: g.supplierId } });
      const number = await nextNumber(tx, ctx.orgId, "OC", 5);
      let subtotal = 0, discount = 0, tax = 0, maxLead = supplier.averageLeadTime;
      const itemsData = [];
      for (const l of g.lines) {
        const p = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
        const sp = await tx.supplierProduct.findUnique({ where: { supplierId_productId: { supplierId: g.supplierId, productId: l.productId } } });
        if (sp) maxLead = Math.max(maxLead, sp.leadTimeDays);
        const gross = l.quantity * l.unitPrice;
        const d = gross * (l.discountPct / 100);
        const t = (gross - d) * (p.taxRate / 100);
        subtotal += gross; discount += d; tax += t;
        itemsData.push({ productId: l.productId, quantity: l.quantity, unitCost: l.unitPrice, discountPct: l.discountPct, taxRate: p.taxRate, total: round2(gross - d + t) });
      }
      const po = await tx.purchaseOrder.create({
        data: {
          organizationId: ctx.orgId,
          number,
          supplierId: g.supplierId,
          warehouseId: cmp.requirement.warehouseId,
          requirementId,
          status: "DRAFT",
          expectedDate: new Date(Date.now() + maxLead * DAY),
          subtotal: round2(subtotal),
          discount: round2(discount),
          shipping: supplier.shippingCost,
          tax: round2(tax),
          total: round2(subtotal - discount + tax + supplier.shippingCost),
          paymentTerms: supplier.creditDays > 0 ? `Crédito ${supplier.creditDays} días` : supplier.paymentTerms,
          createdById: ctx.userId,
          items: { create: itemsData },
        },
      });
      ids.push(po.id);
      await audit(tx, ctx, "purchase_order.create", "PurchaseOrder", po.id, undefined, { number, total: po.total, requirementId });
    }
    await tx.purchaseRequirement.update({ where: { id: requirementId }, data: { status: "ORDERED" } });
    return ids;
  });
}
