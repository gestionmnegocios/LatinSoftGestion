import { prisma, DomainError, requirePermission, round2, type Ctx } from "../db";
import { applyMovement, checkPendingOrders, ensureBalance } from "./inventory";
import { audit, nextNumber, notify } from "./common";

const DAY = 86400000;

export const PO_FLOW: Record<string, string[]> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["CANCELLED"],
  PARTIALLY_RECEIVED: ["CLOSED"],
  RECEIVED: ["CLOSED"],
};

export async function createPurchaseOrder(
  ctx: Ctx,
  input: { supplierId: string; warehouseId: string; items: { productId: string; quantity: number; unitCost: number }[]; notes?: string },
) {
  requirePermission(ctx, "purchase.create");
  const items = input.items.filter((i) => i.quantity > 0);
  if (!input.supplierId) throw new DomainError("Seleccione un proveedor.");
  if (!items.length) throw new DomainError("Agregue al menos un producto.");
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirstOrThrow({ where: { id: input.supplierId, organizationId: ctx.orgId } });
    const number = await nextNumber(tx, ctx.orgId, "OC", 5);
    let subtotal = 0, tax = 0;
    const data = [];
    for (const i of items) {
      const p = await tx.product.findFirstOrThrow({ where: { id: i.productId, organizationId: ctx.orgId } });
      const sub = i.quantity * i.unitCost;
      const t = sub * (p.taxRate / 100);
      subtotal += sub; tax += t;
      data.push({ productId: p.id, quantity: i.quantity, unitCost: i.unitCost, taxRate: p.taxRate, total: round2(sub + t) });
    }
    const po = await tx.purchaseOrder.create({
      data: {
        organizationId: ctx.orgId,
        number,
        supplierId: supplier.id,
        warehouseId: input.warehouseId,
        expectedDate: new Date(Date.now() + supplier.averageLeadTime * DAY),
        subtotal: round2(subtotal),
        shipping: supplier.shippingCost,
        tax: round2(tax),
        total: round2(subtotal + tax + supplier.shippingCost),
        paymentTerms: supplier.creditDays > 0 ? `Crédito ${supplier.creditDays} días` : supplier.paymentTerms,
        notes: input.notes,
        createdById: ctx.userId,
        items: { create: data },
      },
    });
    await audit(tx, ctx, "purchase_order.create", "PurchaseOrder", po.id, undefined, { number, total: po.total });
    return po;
  });
}

/** Transiciones de estado de la OC. Al confirmar, la mercancía pasa a "en tránsito" (incoming). */
export async function transitionPurchaseOrder(ctx: Ctx, poId: string, to: string) {
  requirePermission(ctx, to === "SENT" || to === "CONFIRMED" ? "purchase.approve" : "purchase.create");
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirstOrThrow({ where: { id: poId, organizationId: ctx.orgId }, include: { items: true } });
    if (!PO_FLOW[po.status]?.includes(to)) {
      throw new DomainError(`No se puede pasar la OC de ${po.status} a ${to}.`);
    }
    const wasIncoming = ["CONFIRMED", "IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(po.status);
    if (to === "CONFIRMED") {
      for (const it of po.items) {
        const bal = await ensureBalance(tx, ctx.orgId, po.warehouseId, it.productId);
        await tx.inventoryBalance.update({ where: { id: bal.id }, data: { incoming: round2(bal.incoming + it.quantity - it.receivedQuantity) } });
      }
    }
    if ((to === "CANCELLED" || to === "CLOSED") && wasIncoming) {
      for (const it of po.items) {
        const pending = it.quantity - it.receivedQuantity;
        if (pending <= 0) continue;
        const bal = await ensureBalance(tx, ctx.orgId, po.warehouseId, it.productId);
        await tx.inventoryBalance.update({ where: { id: bal.id }, data: { incoming: round2(Math.max(0, bal.incoming - pending)) } });
      }
    }
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: to, ...(to === "SENT" ? { approvedById: ctx.userId } : {}) },
    });
    await audit(tx, ctx, `purchase_order.${to.toLowerCase()}`, "PurchaseOrder", po.id, { status: po.status }, { status: to });
  });
}

export type ReceiptLine = {
  purchaseOrderItemId: string;
  receivedQuantity: number;
  rejectedQuantity: number;
  unitCost: number;
  lotNumber?: string;
  expirationDate?: string;
};

/**
 * Confirmar recepción (PRD §16, Arq. §29) — transacción atómica:
 * GoodsReceipt → Kardex → Inventario → costo promedio → OC → CxP → pedidos pendientes.
 */
export async function confirmGoodsReceipt(ctx: Ctx, poId: string, lines: ReceiptLine[], notes?: string) {
  requirePermission(ctx, "inventory.receive");
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirstOrThrow({
      where: { id: poId, organizationId: ctx.orgId },
      include: { items: { include: { product: true } }, supplier: true },
    });
    if (!["CONFIRMED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "SENT"].includes(po.status)) {
      throw new DomainError("La OC debe estar enviada, confirmada o en tránsito para recibir mercancía.");
    }
    const effective = lines.filter((l) => l.receivedQuantity > 0);
    if (!effective.length) throw new DomainError("Indique al menos una cantidad recibida.");

    // Si se recibe una OC solo "enviada", se considera confirmada implícitamente.
    if (po.status === "SENT") {
      for (const it of po.items) {
        const bal = await ensureBalance(tx, ctx.orgId, po.warehouseId, it.productId);
        await tx.inventoryBalance.update({ where: { id: bal.id }, data: { incoming: round2(bal.incoming + it.quantity - it.receivedQuantity) } });
      }
    }

    const number = await nextNumber(tx, ctx.orgId, "REC", 5);
    const receipt = await tx.goodsReceipt.create({
      data: {
        organizationId: ctx.orgId,
        number,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        warehouseId: po.warehouseId,
        receivedById: ctx.userId,
        receivedByName: ctx.userName,
        notes,
      },
    });

    let payable = 0;
    for (const l of effective) {
      const it = po.items.find((i) => i.id === l.purchaseOrderItemId);
      if (!it) throw new DomainError("Línea de OC no válida.");
      const pending = round2(it.quantity - it.receivedQuantity);
      const rejected = Math.max(0, l.rejectedQuantity || 0);
      if (rejected > l.receivedQuantity) throw new DomainError(`${it.product.name}: lo rechazado no puede superar lo recibido.`);
      const accepted = round2(l.receivedQuantity - rejected);
      if (accepted > pending) throw new DomainError(`${it.product.name}: se aceptan ${accepted} pero solo faltan ${pending} por recibir.`);
      if (it.product.trackLot && !l.lotNumber) throw new DomainError(`${it.product.name} requiere número de lote.`);
      if (it.product.trackExpiration && !l.expirationDate) throw new DomainError(`${it.product.name} requiere fecha de vencimiento.`);
      const unitCost = l.unitCost > 0 ? l.unitCost : it.unitCost;
      const exp = l.expirationDate ? new Date(l.expirationDate) : null;

      await tx.goodsReceiptItem.create({
        data: {
          goodsReceiptId: receipt.id,
          purchaseOrderItemId: it.id,
          productId: it.productId,
          orderedQuantity: it.quantity,
          receivedQuantity: l.receivedQuantity,
          acceptedQuantity: accepted,
          rejectedQuantity: rejected,
          unitCost,
          lotNumber: l.lotNumber || null,
          expirationDate: exp,
        },
      });
      if (accepted > 0) {
        await applyMovement(tx, ctx, {
          productId: it.productId,
          warehouseId: po.warehouseId,
          type: "PURCHASE_RECEIPT",
          quantity: accepted,
          unitCost,
          referenceType: "GOODS_RECEIPT",
          referenceId: receipt.id,
          referenceNumber: `${number} / ${po.number}`,
          lotNumber: l.lotNumber || null,
          expirationDate: exp,
        });
        const bal = await ensureBalance(tx, ctx.orgId, po.warehouseId, it.productId);
        await tx.inventoryBalance.update({ where: { id: bal.id }, data: { incoming: round2(Math.max(0, bal.incoming - accepted)) } });
        await tx.purchaseOrderItem.update({ where: { id: it.id }, data: { receivedQuantity: round2(it.receivedQuantity + accepted) } });
        const lineNet = accepted * unitCost * (1 - it.discountPct / 100);
        payable += lineNet * (1 + it.taxRate / 100);
      }
    }

    const fresh = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
    const complete = fresh.every((i) => i.receivedQuantity >= i.quantity);
    const status = complete ? "RECEIVED" : "PARTIALLY_RECEIVED";
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } });

    // Cuenta por pagar: transporte se carga en la primera recepción.
    const firstReceipt = (await tx.goodsReceipt.count({ where: { purchaseOrderId: po.id } })) === 1;
    if (firstReceipt) payable += po.shipping;
    if (payable > 0) {
      await tx.accountPayable.create({
        data: {
          organizationId: ctx.orgId,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          goodsReceiptId: receipt.id,
          documentNumber: `${po.number} / ${number}`,
          amount: round2(payable),
          dueDate: new Date(Date.now() + po.supplier.creditDays * DAY),
        },
      });
    }

    if (!complete) {
      await notify(tx, ctx.orgId, "PARTIAL_RECEIPT", "Recepción parcial", `${po.number}: quedan unidades pendientes por recibir de ${po.supplier.tradeName ?? po.supplier.legalName}.`, `/compras/ordenes/${po.id}`);
    }
    for (const l of effective) {
      const it = po.items.find((i) => i.id === l.purchaseOrderItemId)!;
      await checkPendingOrders(tx, ctx, it.productId, po.warehouseId);
    }
    await audit(tx, ctx, "goods_receipt.confirm", "GoodsReceipt", receipt.id, { poStatus: po.status }, { number, poStatus: status, lines: effective });
    return { receipt, status };
  });
}

export async function payPayable(ctx: Ctx, payableId: string) {
  requirePermission(ctx, "finance.pay");
  await prisma.$transaction(async (tx) => {
    const ap = await tx.accountPayable.findFirstOrThrow({ where: { id: payableId, organizationId: ctx.orgId } });
    if (ap.status === "PAID") throw new DomainError("Esta cuenta ya está pagada.");
    const amount = round2(ap.amount - ap.paidAmount);
    await tx.accountPayable.update({ where: { id: ap.id }, data: { paidAmount: ap.amount, status: "PAID" } });
    await tx.cashMovement.create({
      data: { organizationId: ctx.orgId, type: "OUT", amount, concept: `Pago a proveedor ${ap.documentNumber}`, referenceType: "PAYABLE", referenceId: ap.id, userId: ctx.userId },
    });
    await audit(tx, ctx, "payable.pay", "AccountPayable", ap.id, { paidAmount: ap.paidAmount }, { paidAmount: ap.amount });
  });
}
