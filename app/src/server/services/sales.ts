import { prisma, DomainError, requirePermission, round2, type Ctx } from "../db";
import { applyMovement, ensureBalance, releaseStock, reserveStock } from "./inventory";
import { audit, nextNumber, notify } from "./common";

export function computeLine(quantity: number, unitPrice: number, discountPct: number, taxRate: number) {
  const gross = quantity * unitPrice;
  const discount = gross * (discountPct / 100);
  const subtotal = round2(gross - discount);
  const tax = round2(subtotal * (taxRate / 100));
  return { gross: round2(gross), discount: round2(discount), subtotal, tax, total: round2(subtotal + tax) };
}

export type QuoteInput = {
  id?: string;
  customerId: string;
  priceListId?: string | null;
  warehouseId: string;
  validityDays: number;
  notes?: string;
  items: { productId: string; quantity: number; unitPrice: number; discountPct: number }[];
};

export async function saveQuotation(ctx: Ctx, input: QuoteInput, status: "DRAFT" | "SENT" = "DRAFT") {
  requirePermission(ctx, "sales.quote.create");
  if (!input.customerId) throw new DomainError("Seleccione un cliente.");
  const items = input.items.filter((i) => i.quantity > 0);
  if (!items.length) throw new DomainError("Agregue al menos un producto.");

  return prisma.$transaction(async (tx) => {
    const lines = [];
    let subtotal = 0, discount = 0, tax = 0;
    for (const i of items) {
      const p = await tx.product.findFirstOrThrow({ where: { id: i.productId, organizationId: ctx.orgId } });
      const bal = await ensureBalance(tx, ctx.orgId, input.warehouseId, p.id);
      const c = computeLine(i.quantity, i.unitPrice, i.discountPct, p.taxRate);
      subtotal += c.subtotal; discount += c.discount; tax += c.tax;
      lines.push({
        productId: p.id,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discountPct: i.discountPct,
        taxRate: p.taxRate,
        subtotal: c.subtotal,
        tax: c.tax,
        total: c.total,
        // Qué disponibilidad veía el vendedor al cotizar (no reserva)
        availableStockSnapshot: bal.onHand - bal.reserved,
      });
    }
    const totals = {
      subtotal: round2(subtotal),
      discount: round2(discount),
      tax: round2(tax),
      total: round2(subtotal + tax),
    };
    const expirationDate = new Date(Date.now() + input.validityDays * 86400000);

    if (input.id) {
      const existing = await tx.quotation.findFirstOrThrow({ where: { id: input.id, organizationId: ctx.orgId } });
      if (!["DRAFT", "SENT"].includes(existing.status)) {
        throw new DomainError("Solo se pueden editar cotizaciones en borrador o enviadas.");
      }
      await tx.quotationItem.deleteMany({ where: { quotationId: existing.id } });
      const q = await tx.quotation.update({
        where: { id: existing.id },
        data: {
          customerId: input.customerId,
          priceListId: input.priceListId,
          warehouseId: input.warehouseId,
          expirationDate,
          notes: input.notes,
          status,
          ...totals,
          items: { create: lines },
        },
      });
      await audit(tx, ctx, "quotation.update", "Quotation", q.id, { total: existing.total }, { total: q.total, status });
      return q;
    }
    const number = await nextNumber(tx, ctx.orgId, "COT");
    const q = await tx.quotation.create({
      data: {
        organizationId: ctx.orgId,
        number,
        customerId: input.customerId,
        priceListId: input.priceListId,
        warehouseId: input.warehouseId,
        salespersonId: ctx.userId,
        salespersonName: ctx.userName,
        expirationDate,
        notes: input.notes,
        status,
        ...totals,
        items: { create: lines },
      },
    });
    await audit(tx, ctx, "quotation.create", "Quotation", q.id, undefined, { number, total: q.total, status });
    return q;
  });
}

export async function setQuotationStatus(ctx: Ctx, id: string, status: "SENT" | "REJECTED" | "ACCEPTED") {
  requirePermission(ctx, "sales.quote.create");
  const q = await prisma.quotation.findFirstOrThrow({ where: { id, organizationId: ctx.orgId } });
  if (q.status === "CONVERTED") throw new DomainError("La cotización ya fue convertida en pedido.");
  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id }, data: { status } });
    await audit(tx, ctx, `quotation.${status.toLowerCase()}`, "Quotation", id, { status: q.status }, { status });
  });
}

export async function duplicateQuotation(ctx: Ctx, id: string) {
  const q = await prisma.quotation.findFirstOrThrow({ where: { id, organizationId: ctx.orgId }, include: { items: true } });
  return saveQuotation(ctx, {
    customerId: q.customerId,
    priceListId: q.priceListId,
    warehouseId: q.warehouseId,
    validityDays: 15,
    notes: q.notes ?? undefined,
    items: q.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, discountPct: i.discountPct })),
  });
}

/**
 * COT → PED. Vuelve a validar existencias y reserva lo disponible.
 * Lo no reservado queda como faltante y alimenta el motor de abastecimiento.
 */
export async function convertQuotationToOrder(ctx: Ctx, quotationId: string) {
  requirePermission(ctx, "sales.order.create");
  return prisma.$transaction(async (tx) => {
    const q = await tx.quotation.findFirstOrThrow({
      where: { id: quotationId, organizationId: ctx.orgId },
      include: { items: true, salesOrder: true },
    });
    if (q.salesOrder || q.status === "CONVERTED") throw new DomainError("Esta cotización ya fue convertida.");
    if (q.status === "REJECTED") throw new DomainError("La cotización fue rechazada.");
    const number = await nextNumber(tx, ctx.orgId, "PED");
    const order = await tx.salesOrder.create({
      data: {
        organizationId: ctx.orgId,
        number,
        quotationId: q.id,
        customerId: q.customerId,
        warehouseId: q.warehouseId,
        status: "CONFIRMED",
        subtotal: q.subtotal,
        discount: q.discount,
        tax: q.tax,
        total: q.total,
        notes: q.notes,
        confirmedAt: new Date(),
      },
    });
    const shortages: string[] = [];
    for (const it of q.items) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: it.productId } });
      const reserved = await reserveStock(tx, ctx, it.productId, q.warehouseId, it.quantity, { id: order.id, number });
      await tx.salesOrderItem.create({
        data: {
          salesOrderId: order.id,
          productId: it.productId,
          quantity: it.quantity,
          reservedQuantity: reserved,
          unitPrice: it.unitPrice,
          discountPct: it.discountPct,
          taxRate: it.taxRate,
          unitCost: product.averageCost,
          subtotal: it.subtotal,
          tax: it.tax,
          total: it.total,
        },
      });
      if (reserved < it.quantity) shortages.push(`${product.name}: faltan ${round2(it.quantity - reserved)}`);
    }
    const ready = shortages.length === 0;
    await tx.salesOrder.update({ where: { id: order.id }, data: { status: ready ? "READY" : "CONFIRMED" } });
    await tx.quotation.update({ where: { id: q.id }, data: { status: "CONVERTED" } });
    if (!ready) {
      await notify(
        tx,
        ctx.orgId,
        "ORDER_SHORTAGE",
        "Pedido pendiente por faltante",
        `${number}: ${shortages.join("; ")}.`,
        `/ventas/pedidos/${order.id}`,
      );
    }
    await audit(tx, ctx, "sales_order.create", "SalesOrder", order.id, undefined, { number, from: q.number, shortages });
    return { order, shortages };
  });
}

export async function prepareOrder(ctx: Ctx, orderId: string) {
  requirePermission(ctx, "sales.order.prepare");
  const o = await prisma.salesOrder.findFirstOrThrow({ where: { id: orderId, organizationId: ctx.orgId }, include: { items: true } });
  if (!["CONFIRMED", "READY", "PARTIAL"].includes(o.status)) throw new DomainError("El pedido no puede pasar a preparación.");
  await prisma.$transaction(async (tx) => {
    await tx.salesOrder.update({ where: { id: o.id }, data: { status: "PREPARING" } });
    await audit(tx, ctx, "sales_order.prepare", "SalesOrder", o.id, { status: o.status }, { status: "PREPARING" });
  });
}

/** Despacha lo reservado: descuenta existencia física y libera la reserva. */
export async function dispatchOrder(ctx: Ctx, orderId: string) {
  requirePermission(ctx, "sales.order.dispatch");
  return prisma.$transaction(async (tx) => {
    const o = await tx.salesOrder.findFirstOrThrow({ where: { id: orderId, organizationId: ctx.orgId }, include: { items: { include: { product: true } } } });
    if (!["CONFIRMED", "PREPARING", "READY", "PARTIAL"].includes(o.status)) {
      throw new DomainError("El pedido no está en un estado despachable.");
    }
    let dispatched = 0;
    for (const it of o.items) {
      const qty = it.reservedQuantity;
      if (qty <= 0) continue;
      await releaseStock(tx, ctx, it.productId, o.warehouseId, qty, { id: o.id, number: o.number }, true);
      await applyMovement(tx, ctx, {
        productId: it.productId,
        warehouseId: o.warehouseId,
        type: "SALE",
        quantity: -qty,
        unitCost: it.product.averageCost,
        referenceType: "SALES_ORDER",
        referenceId: o.id,
        referenceNumber: o.number,
      });
      await tx.salesOrderItem.update({
        where: { id: it.id },
        data: { reservedQuantity: 0, fulfilledQuantity: round2(it.fulfilledQuantity + qty), unitCost: it.product.averageCost },
      });
      dispatched += qty;
    }
    if (dispatched === 0) throw new DomainError("No hay unidades reservadas para despachar. Espere la recepción de mercancía.");
    const items = await tx.salesOrderItem.findMany({ where: { salesOrderId: o.id } });
    const complete = items.every((i) => i.fulfilledQuantity >= i.quantity);
    const status = complete ? "DISPATCHED" : "PARTIAL";
    await tx.salesOrder.update({ where: { id: o.id }, data: { status, dispatchedAt: complete ? new Date() : null } });
    await audit(tx, ctx, "sales_order.dispatch", "SalesOrder", o.id, { status: o.status }, { status, dispatched });
    return { status, dispatched };
  });
}

export async function deliverOrder(ctx: Ctx, orderId: string) {
  requirePermission(ctx, "sales.order.dispatch");
  const o = await prisma.salesOrder.findFirstOrThrow({ where: { id: orderId, organizationId: ctx.orgId } });
  if (o.status !== "DISPATCHED") throw new DomainError("Solo pedidos despachados pueden marcarse como entregados.");
  await prisma.$transaction(async (tx) => {
    await tx.salesOrder.update({ where: { id: o.id }, data: { status: "DELIVERED" } });
    await audit(tx, ctx, "sales_order.deliver", "SalesOrder", o.id, { status: o.status }, { status: "DELIVERED" });
  });
}

export async function cancelOrder(ctx: Ctx, orderId: string) {
  requirePermission(ctx, "sales.order.create");
  await prisma.$transaction(async (tx) => {
    const o = await tx.salesOrder.findFirstOrThrow({ where: { id: orderId, organizationId: ctx.orgId }, include: { items: true } });
    if (["DISPATCHED", "DELIVERED", "CANCELLED", "PARTIAL"].includes(o.status)) {
      throw new DomainError("Este pedido ya no puede cancelarse.");
    }
    for (const it of o.items) {
      await releaseStock(tx, ctx, it.productId, o.warehouseId, it.reservedQuantity, { id: o.id, number: o.number });
      await tx.salesOrderItem.update({ where: { id: it.id }, data: { reservedQuantity: 0 } });
    }
    await tx.salesOrder.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, "sales_order.cancel", "SalesOrder", o.id, { status: o.status }, { status: "CANCELLED" });
  });
}

export async function invoiceOrder(ctx: Ctx, orderId: string) {
  requirePermission(ctx, "finance.invoice");
  return prisma.$transaction(async (tx) => {
    const o = await tx.salesOrder.findFirstOrThrow({ where: { id: orderId, organizationId: ctx.orgId }, include: { invoice: true, customer: true } });
    if (o.invoice) throw new DomainError("El pedido ya fue facturado.");
    if (!["DISPATCHED", "DELIVERED"].includes(o.status)) throw new DomainError("Solo se facturan pedidos despachados completamente.");
    const number = await nextNumber(tx, ctx.orgId, "FV");
    const inv = await tx.invoice.create({
      data: {
        organizationId: ctx.orgId,
        number,
        salesOrderId: o.id,
        customerId: o.customerId,
        dueDate: new Date(Date.now() + (o.customer.creditDays || 0) * 86400000),
        subtotal: o.subtotal,
        tax: o.tax,
        total: o.total,
      },
    });
    await audit(tx, ctx, "invoice.create", "Invoice", inv.id, undefined, { number, total: inv.total });
    return inv;
  });
}

export async function registerPayment(ctx: Ctx, invoiceId: string, amount: number, method: string) {
  requirePermission(ctx, "finance.receive_payment");
  if (!(amount > 0)) throw new DomainError("El valor debe ser mayor a 0.");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId, organizationId: ctx.orgId } });
    const balance = round2(inv.total - inv.paidAmount);
    if (amount > balance + 0.01) throw new DomainError(`El pago supera el saldo ($${balance.toLocaleString("es-CO")}).`);
    await tx.payment.create({ data: { organizationId: ctx.orgId, invoiceId, amount, method, userId: ctx.userId } });
    const paid = round2(inv.paidAmount + amount);
    await tx.invoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: paid >= inv.total - 0.01 ? "PAID" : "PARTIAL" } });
    await tx.cashMovement.create({
      data: { organizationId: ctx.orgId, type: "IN", amount, concept: `Pago factura ${inv.number} (${method})`, referenceType: "INVOICE", referenceId: inv.id, userId: ctx.userId },
    });
    await audit(tx, ctx, "payment.create", "Invoice", inv.id, { paidAmount: inv.paidAmount }, { paidAmount: paid, method });
  });
}
