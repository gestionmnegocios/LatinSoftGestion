import { prisma, DomainError, requirePermission, round2, type Ctx, type Tx } from "../db";
import { audit, nextNumber, notify } from "./common";

export type StockStatus = "NORMAL" | "LOW" | "OUT_OF_STOCK" | "OVERSTOCK";

/**
 * Criterio único de estado de inventario (Arquitectura §44).
 * Dashboard, cotización, productos y compras usan exactamente esta función.
 */
export function getStockStatus(p: {
  onHand: number;
  reserved: number;
  minimumStock: number;
  maximumStock: number;
}): StockStatus {
  const available = p.onHand - p.reserved;
  if (available <= 0) return "OUT_OF_STOCK";
  if (available <= p.minimumStock) return "LOW";
  if (p.maximumStock > 0 && p.onHand > p.maximumStock) return "OVERSTOCK";
  return "NORMAL";
}

export const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE_RECEIPT: "Entrada compra",
  SALE: "Salida venta",
  TRANSFER_IN: "Transferencia entrada",
  TRANSFER_OUT: "Transferencia salida",
  POSITIVE_ADJUSTMENT: "Ajuste positivo",
  NEGATIVE_ADJUSTMENT: "Ajuste negativo",
  CUSTOMER_RETURN: "Devolución cliente",
  SUPPLIER_RETURN: "Devolución proveedor",
  RESERVATION: "Reserva",
  RESERVATION_RELEASE: "Liberación reserva",
};

export async function ensureBalance(tx: Tx, orgId: string, warehouseId: string, productId: string) {
  return tx.inventoryBalance.upsert({
    where: { warehouseId_productId: { warehouseId, productId } },
    create: { organizationId: orgId, warehouseId, productId },
    update: {},
  });
}

type MovementInput = {
  productId: string;
  warehouseId: string;
  type: string;
  /** Cantidad con signo: positiva entra, negativa sale. */
  quantity: number;
  unitCost?: number;
  referenceType?: string;
  referenceId?: string;
  referenceNumber?: string;
  lotNumber?: string | null;
  expirationDate?: Date | null;
  notes?: string;
  createdAt?: Date;
};

/**
 * Única vía para modificar la existencia física. Todo cambio genera un
 * movimiento de Kardex con cantidad anterior y resultante (PRD §10, Arq. §12).
 */
export async function applyMovement(tx: Tx, ctx: Ctx, m: MovementInput) {
  if (m.quantity === 0) return null;
  const bal = await ensureBalance(tx, ctx.orgId, m.warehouseId, m.productId);
  const product = await tx.product.findUniqueOrThrow({ where: { id: m.productId } });
  const previous = bal.onHand;
  const resulting = round2(previous + m.quantity);
  if (resulting < 0) {
    throw new DomainError(
      `Existencia insuficiente de ${product.name}: hay ${previous}, se intentan retirar ${-m.quantity}.`,
    );
  }
  const unitCost = m.unitCost ?? product.averageCost;

  // Costo promedio ponderado móvil en entradas de compra (Arq. §30)
  if (m.type === "PURCHASE_RECEIPT" && m.quantity > 0) {
    const agg = await tx.inventoryBalance.aggregate({
      where: { productId: m.productId, organizationId: ctx.orgId },
      _sum: { onHand: true },
    });
    const totalOnHand = Math.max(0, agg._sum.onHand ?? 0);
    const newAvg =
      totalOnHand + m.quantity > 0
        ? (totalOnHand * product.averageCost + m.quantity * unitCost) / (totalOnHand + m.quantity)
        : unitCost;
    await tx.product.update({
      where: { id: m.productId },
      data: { averageCost: round2(newAvg), lastCost: unitCost },
    });
  }

  await tx.inventoryBalance.update({ where: { id: bal.id }, data: { onHand: resulting } });
  return tx.inventoryMovement.create({
    data: {
      organizationId: ctx.orgId,
      productId: m.productId,
      warehouseId: m.warehouseId,
      movementType: m.type,
      quantity: m.quantity,
      previousQuantity: previous,
      resultingQuantity: resulting,
      unitCost,
      totalCost: round2(Math.abs(m.quantity) * unitCost),
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      referenceNumber: m.referenceNumber,
      lotNumber: m.lotNumber ?? null,
      expirationDate: m.expirationDate ?? null,
      userId: ctx.userId,
      userName: ctx.userName,
      notes: m.notes,
      ...(m.createdAt ? { createdAt: m.createdAt } : {}),
    },
  });
}

/** Reserva hasta `qty` unidades disponibles. Devuelve lo efectivamente reservado. */
export async function reserveStock(
  tx: Tx,
  ctx: Ctx,
  productId: string,
  warehouseId: string,
  qty: number,
  ref: { id: string; number: string },
) {
  const bal = await ensureBalance(tx, ctx.orgId, warehouseId, productId);
  const available = Math.max(0, bal.onHand - bal.reserved);
  const toReserve = Math.min(available, qty);
  if (toReserve <= 0) return 0;
  await tx.inventoryBalance.update({
    where: { id: bal.id },
    data: { reserved: round2(bal.reserved + toReserve) },
  });
  await tx.inventoryMovement.create({
    data: {
      organizationId: ctx.orgId,
      productId,
      warehouseId,
      movementType: "RESERVATION",
      quantity: toReserve,
      previousQuantity: available,
      resultingQuantity: round2(available - toReserve),
      referenceType: "SALES_ORDER",
      referenceId: ref.id,
      referenceNumber: ref.number,
      userId: ctx.userId,
      userName: ctx.userName,
      notes: "Disponible antes/después de la reserva",
    },
  });
  return toReserve;
}

export async function releaseStock(
  tx: Tx,
  ctx: Ctx,
  productId: string,
  warehouseId: string,
  qty: number,
  ref: { id: string; number: string },
  silent = false,
) {
  if (qty <= 0) return;
  const bal = await ensureBalance(tx, ctx.orgId, warehouseId, productId);
  const available = bal.onHand - bal.reserved;
  await tx.inventoryBalance.update({
    where: { id: bal.id },
    data: { reserved: round2(Math.max(0, bal.reserved - qty)) },
  });
  if (silent) return;
  await tx.inventoryMovement.create({
    data: {
      organizationId: ctx.orgId,
      productId,
      warehouseId,
      movementType: "RESERVATION_RELEASE",
      quantity: qty,
      previousQuantity: available,
      resultingQuantity: round2(available + qty),
      referenceType: "SALES_ORDER",
      referenceId: ref.id,
      referenceNumber: ref.number,
      userId: ctx.userId,
      userName: ctx.userName,
    },
  });
}

/** Ajuste: nunca se edita la cantidad; se registra la diferencia como movimiento. */
export async function adjustInventory(
  ctx: Ctx,
  input: { productId: string; warehouseId: string; newQuantity: number; reason: string; unitCost?: number },
) {
  requirePermission(ctx, "inventory.adjust");
  if (!(input.newQuantity >= 0)) throw new DomainError("La nueva cantidad debe ser mayor o igual a 0.");
  if (!input.reason?.trim()) throw new DomainError("Indique el motivo del ajuste.");
  return prisma.$transaction(async (tx) => {
    const bal = await ensureBalance(tx, ctx.orgId, input.warehouseId, input.productId);
    const diff = round2(input.newQuantity - bal.onHand);
    if (diff === 0) throw new DomainError("La cantidad nueva es igual a la actual.");
    if (input.newQuantity < bal.reserved) {
      throw new DomainError(
        `No puede ajustar por debajo de lo comprometido en pedidos (${bal.reserved} unidades).`,
      );
    }
    const number = await nextNumber(tx, ctx.orgId, "AJ", 4);
    const mov = await applyMovement(tx, ctx, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: diff > 0 ? "POSITIVE_ADJUSTMENT" : "NEGATIVE_ADJUSTMENT",
      quantity: diff,
      unitCost: input.unitCost,
      referenceType: "ADJUSTMENT",
      referenceNumber: number,
      notes: input.reason,
    });
    await audit(tx, ctx, "inventory.adjust", "InventoryBalance", bal.id, { onHand: bal.onHand }, {
      onHand: input.newQuantity,
      reason: input.reason,
      number,
    });
    if (diff > 0) await checkPendingOrders(tx, ctx, input.productId, input.warehouseId);
    return mov;
  });
}

export async function transferInventory(
  ctx: Ctx,
  input: { fromWarehouseId: string; toWarehouseId: string; items: { productId: string; quantity: number }[]; notes?: string },
) {
  requirePermission(ctx, "inventory.transfer");
  if (input.fromWarehouseId === input.toWarehouseId) throw new DomainError("Las bodegas deben ser distintas.");
  const items = input.items.filter((i) => i.quantity > 0);
  if (!items.length) throw new DomainError("Agregue al menos un producto con cantidad.");
  return prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "TR", 4);
    const t = await tx.transfer.create({
      data: {
        organizationId: ctx.orgId,
        number,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        notes: input.notes,
        createdById: ctx.userId,
        items: { create: items.map((i) => ({ productId: i.productId, quantity: i.quantity })) },
      },
    });
    for (const i of items) {
      const bal = await ensureBalance(tx, ctx.orgId, input.fromWarehouseId, i.productId);
      if (bal.onHand - bal.reserved < i.quantity) {
        const p = await tx.product.findUniqueOrThrow({ where: { id: i.productId } });
        throw new DomainError(
          `${p.name}: solo hay ${bal.onHand - bal.reserved} disponibles para transferir (el resto está comprometido).`,
        );
      }
      const ref = { referenceType: "TRANSFER", referenceId: t.id, referenceNumber: number };
      await applyMovement(tx, ctx, { ...ref, productId: i.productId, warehouseId: input.fromWarehouseId, type: "TRANSFER_OUT", quantity: -i.quantity });
      await applyMovement(tx, ctx, { ...ref, productId: i.productId, warehouseId: input.toWarehouseId, type: "TRANSFER_IN", quantity: i.quantity });
      await checkPendingOrders(tx, ctx, i.productId, input.toWarehouseId);
    }
    await audit(tx, ctx, "inventory.transfer", "Transfer", t.id, undefined, input);
    return t;
  });
}

/**
 * Conexión compra → venta (Arq. §31): cuando entra mercancía, intenta
 * reservar para pedidos con faltante y avisa si ya pueden completarse.
 */
export async function checkPendingOrders(tx: Tx, ctx: Ctx, productId: string, warehouseId: string) {
  const items = await tx.salesOrderItem.findMany({
    where: {
      productId,
      salesOrder: {
        organizationId: ctx.orgId,
        warehouseId,
        status: { in: ["CONFIRMED", "PREPARING", "PARTIAL"] },
      },
    },
    include: { salesOrder: { include: { items: true } } },
    orderBy: { salesOrder: { confirmedAt: "asc" } },
  });
  for (const it of items) {
    const pending = it.quantity - it.reservedQuantity - it.fulfilledQuantity;
    if (pending <= 0) continue;
    const got = await reserveStock(tx, ctx, productId, warehouseId, pending, {
      id: it.salesOrderId,
      number: it.salesOrder.number,
    });
    if (got <= 0) continue;
    await tx.salesOrderItem.update({
      where: { id: it.id },
      data: { reservedQuantity: round2(it.reservedQuantity + got) },
    });
    const fresh = await tx.salesOrderItem.findMany({ where: { salesOrderId: it.salesOrderId } });
    const complete = fresh.every((f) => f.reservedQuantity + f.fulfilledQuantity >= f.quantity);
    if (complete) {
      await tx.salesOrder.update({ where: { id: it.salesOrderId }, data: { status: "READY" } });
      await notify(
        tx,
        ctx.orgId,
        "ORDER_READY",
        "Pedido listo para despacho",
        `El pedido ${it.salesOrder.number} ya cuenta con inventario suficiente para completar el despacho.`,
        `/ventas/pedidos/${it.salesOrderId}`,
      );
    }
  }
}

/** Fila de inventario consolidada para tablas y motores. */
export type StockRow = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  averageCost: number;
  salePrice: number;
  minimumStock: number;
  maximumStock: number;
  safetyStock: number;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  projected: number;
  status: StockStatus;
};

export async function getStockRows(orgId: string, warehouseId?: string | null): Promise<StockRow[]> {
  const products = await prisma.product.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    include: {
      category: true,
      balances: warehouseId ? { where: { warehouseId } } : true,
    },
    orderBy: { sku: "asc" },
  });
  return products.map((p) => {
    const onHand = p.balances.reduce((s, b) => s + b.onHand, 0);
    const reserved = p.balances.reduce((s, b) => s + b.reserved, 0);
    const incoming = p.balances.reduce((s, b) => s + b.incoming, 0);
    const available = round2(onHand - reserved);
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category?.name ?? "—",
      unit: p.unit,
      averageCost: p.averageCost,
      salePrice: p.salePrice,
      minimumStock: p.minimumStock,
      maximumStock: p.maximumStock,
      safetyStock: p.safetyStock,
      onHand,
      reserved,
      available,
      incoming,
      projected: round2(onHand - reserved + incoming),
      status: getStockStatus({ onHand, reserved, minimumStock: p.minimumStock, maximumStock: p.maximumStock }),
    };
  });
}
