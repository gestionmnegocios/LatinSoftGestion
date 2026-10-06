/* Flujo end-to-end obligatorio del PRD (§41 / Arquitectura §45), contra los servicios reales.
 * Crea una organización aislada, ejecuta el ciclo completo y verifica cada número. */
import assert from "node:assert/strict";
import { prisma, type Ctx } from "../src/server/db";
import { adjustInventory, getStockRows } from "../src/server/services/inventory";
import { saveQuotation, convertQuotationToOrder, dispatchOrder, invoiceOrder, registerPayment } from "../src/server/services/sales";
import { calculateRequirements, createRequirement, compareSuppliers, createOrdersFromComparison } from "../src/server/services/procurement";
import { transitionPurchaseOrder, confirmGoodsReceipt } from "../src/server/services/purchasing";
import { searchIds } from "../src/server/search";

let step = 0;
const ok = (msg: string) => console.log(`  ✔ ${String(++step).padStart(2, "0")} ${msg}`);

async function bal(warehouseId: string, productId: string) {
  return prisma.inventoryBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId, productId } } });
}

async function main() {
  console.log("Flujo E2E LatinSoftGestion");
  const slug = `e2e-${Date.now()}`;
  const org = await prisma.organization.create({ data: { name: "E2E Org", slug } });
  try {
    const wh = await prisma.warehouse.create({ data: { organizationId: org.id, code: "E2E", name: "Bodega E2E" } });
    const ctx: Ctx = { orgId: org.id, userId: null, userName: "E2E", permissions: new Set(["*"]), warehouseId: wh.id };
    ok("Crear organización y bodega");

    const supplierA = await prisma.supplier.create({ data: { organizationId: org.id, taxId: "1", legalName: "Proveedor Rápido", creditDays: 30, averageLeadTime: 2, shippingCost: 0, fulfillmentRating: 4.8 } });
    const supplierB = await prisma.supplier.create({ data: { organizationId: org.id, taxId: "2", legalName: "Proveedor Barato", creditDays: 0, averageLeadTime: 7, shippingCost: 0, fulfillmentRating: 3.5 } });
    ok("Crear proveedores");

    const product = await prisma.product.create({
      data: { organizationId: org.id, sku: "E2E-1", name: "Escoba E2E", averageCost: 10000, lastCost: 10000, salePrice: 15000, minimumStock: 2, taxRate: 19 },
    });
    await prisma.supplierProduct.create({ data: { organizationId: org.id, supplierId: supplierA.id, productId: product.id, price: 12000, leadTimeDays: 2 } });
    await prisma.supplierProduct.create({ data: { organizationId: org.id, supplierId: supplierB.id, productId: product.id, price: 11800, leadTimeDays: 7 } });
    ok("Crear producto con dos proveedores");

    await adjustInventory(ctx, { productId: product.id, warehouseId: wh.id, newQuantity: 10, reason: "Entrada inicial" });
    let b = await bal(wh.id, product.id);
    assert.equal(b.onHand, 10);
    ok("Entrada inicial = 10 (vía movimiento de ajuste)");

    const customer = await prisma.customer.create({ data: { organizationId: org.id, documentNumber: "123", name: "Clínica Médica E2E", creditDays: 0 } });
    ok("Crear cliente");

    assert.deepEqual(await searchIds("Customer", org.id, "CLINICA medica"), [customer.id]);
    assert.deepEqual(await searchIds("Customer", org.id, "100%_x"), []);
    assert.deepEqual(await searchIds("Product", org.id, "escoba"), [product.id]);
    ok("Búsqueda ignora tildes y mayúsculas, y escapa comodines");

    const quote = await saveQuotation(ctx, {
      customerId: customer.id, warehouseId: wh.id, validityDays: 15,
      items: [{ productId: product.id, quantity: 20, unitPrice: 15000, discountPct: 0 }],
    });
    const qi = await prisma.quotationItem.findFirstOrThrow({ where: { quotationId: quote.id } });
    assert.equal(qi.availableStockSnapshot, 10);
    assert.equal(quote.subtotal, 300000);
    assert.equal(quote.tax, 57000);
    assert.equal(quote.total, 357000);
    b = await bal(wh.id, product.id);
    assert.equal(b.reserved, 0, "la cotización no reserva");
    ok("Cotizar 20 (snapshot disponible 10, total $357.000, sin reserva)");

    const { order, shortages } = await convertQuotationToOrder(ctx, quote.id);
    b = await bal(wh.id, product.id);
    assert.equal(b.reserved, 10);
    assert.equal(b.onHand - b.reserved, 0);
    assert.equal(shortages.length, 1);
    const oi = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: order.id } });
    assert.equal(oi.reservedQuantity, 10);
    ok("Convertir en pedido → reserva 10, faltante = 10");

    await assert.rejects(() => convertQuotationToOrder(ctx, quote.id), /ya fue convertida/);
    ok("No permite convertir dos veces la misma cotización");

    const reqs = await calculateRequirements(org.id, wh.id, 30);
    const r = reqs.find((x) => x.productId === product.id);
    assert.ok(r, "el motor detecta la necesidad");
    assert.equal(r!.shortage, 10);
    assert.ok(r!.suggested >= 10, `sugerido ${r!.suggested} cubre el faltante`);
    ok(`Motor de reposición detecta faltante 10 (sugiere ${r!.suggested}, razón ${r!.reason})`);

    const requirement = await createRequirement(ctx, wh.id, [{ productId: product.id, quantity: 10 }]);
    ok("Generar necesidad de compra = 10");

    const cmp = await compareSuppliers(org.id, requirement.id);
    assert.equal(cmp.options.length, 2);
    assert.equal(cmp.cheapestId, supplierB.id);
    assert.equal(cmp.recommendedId, supplierA.id, "no asume que el más barato es el mejor");
    ok(`Comparador: recomienda "${cmp.options[0].name}" aunque no es el más barato`);

    const [poId] = await createOrdersFromComparison(ctx, requirement.id, cmp.recommendedId!);
    let po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: true } });
    assert.equal(po.status, "DRAFT");
    assert.equal(po.items[0].quantity, 10);
    assert.match(po.number, /^OC-2026-\d{5}$/);
    ok(`Crear OC ${po.number} = 10`);

    await transitionPurchaseOrder(ctx, poId, "SENT");
    await transitionPurchaseOrder(ctx, poId, "CONFIRMED");
    b = await bal(wh.id, product.id);
    assert.equal(b.incoming, 10);
    ok("Confirmar OC → en tránsito (incoming) = 10");

    await assert.rejects(() => confirmGoodsReceipt(ctx, poId, [{ purchaseOrderItemId: po.items[0].id, receivedQuantity: 11, rejectedQuantity: 0, unitCost: 12000 }]), /solo faltan 10/);
    ok("Rechaza recibir más de lo pendiente (transacción revertida)");
    b = await bal(wh.id, product.id);
    assert.equal(b.onHand, 10, "rollback: el inventario no cambió");

    // Recepción parcial 6 + 4
    await confirmGoodsReceipt(ctx, poId, [{ purchaseOrderItemId: po.items[0].id, receivedQuantity: 6, rejectedQuantity: 0, unitCost: 12000, lotNumber: "L-1" }]);
    po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: true } });
    assert.equal(po.status, "PARTIALLY_RECEIVED");
    b = await bal(wh.id, product.id);
    assert.equal(b.onHand, 16);
    assert.equal(b.incoming, 4);
    assert.equal(b.reserved, 16, "la mercancía recibida se reserva automáticamente para el pedido");
    ok("Recepción parcial 6 → físico 16, en tránsito 4, reserva automática al pedido");

    await confirmGoodsReceipt(ctx, poId, [{ purchaseOrderItemId: po.items[0].id, receivedQuantity: 4, rejectedQuantity: 0, unitCost: 12000 }]);
    po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: true } });
    assert.equal(po.status, "RECEIVED");
    b = await bal(wh.id, product.id);
    assert.equal(b.onHand, 20);
    assert.equal(b.incoming, 0);
    ok("Recibir resto → stock físico = 20, OC recibida");

    const p2 = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(p2.averageCost, 11000); // (10×10.000 + 10×12.000) / 20
    ok("Costo promedio ponderado = $11.000");

    const payables = await prisma.accountPayable.findMany({ where: { organizationId: org.id } });
    assert.equal(payables.reduce((s, p) => s + p.amount, 0), 10 * 12000 * 1.19);
    ok("Cuentas por pagar generadas = $142.800");

    const o2 = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(o2.status, "READY");
    const notif = await prisma.notification.findFirst({ where: { organizationId: org.id, type: "ORDER_READY" } });
    assert.ok(notif?.message.includes(order.number));
    ok(`Pedido ${order.number} listo + notificación "ya cuenta con inventario suficiente"`);

    await dispatchOrder(ctx, order.id);
    b = await bal(wh.id, product.id);
    assert.equal(b.onHand, 0);
    assert.equal(b.reserved, 0);
    const o3 = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(o3.status, "DISPATCHED");
    ok("Despachar 20 → stock físico = 0, pedido despachado");

    const inv = await invoiceOrder(ctx, order.id);
    await registerPayment(ctx, inv.id, inv.total, "Efectivo");
    const inv2 = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    assert.equal(inv2.status, "PAID");
    ok(`Facturar ${inv.number} y registrar pago`);

    // Kardex completamente trazable
    const movs = await prisma.inventoryMovement.findMany({
      where: { organizationId: org.id, productId: product.id, movementType: { notIn: ["RESERVATION", "RESERVATION_RELEASE"] } },
      orderBy: { createdAt: "asc" },
    });
    let running = 0;
    for (const m of movs) {
      assert.equal(m.previousQuantity, running, `continuidad del kardex en ${m.movementType}`);
      running = m.resultingQuantity;
    }
    assert.equal(running, 0);
    assert.deepEqual(movs.map((m) => m.movementType), ["POSITIVE_ADJUSTMENT", "PURCHASE_RECEIPT", "PURCHASE_RECEIPT", "SALE"]);
    ok("Kardex completamente trazable (10 → 16 → 20 → 0)");

    // Aislamiento multi-tenant
    const rowsOther = await getStockRows("otra-org-inexistente");
    assert.equal(rowsOther.length, 0);
    const demoOrg = await prisma.organization.findFirst({ where: { slug: "comercial-demo" } });
    if (demoOrg) {
      const demoRows = await getStockRows(demoOrg.id);
      assert.ok(!demoRows.some((x) => x.productId === product.id));
    }
    ok("Aislamiento multi-tenant: otra organización no ve estos datos");

    // RBAC en backend
    const vendor: Ctx = { ...ctx, permissions: new Set(["sales.quote.create"]) };
    await assert.rejects(() => adjustInventory(vendor, { productId: product.id, warehouseId: wh.id, newQuantity: 5, reason: "x" }), /No tiene permiso/);
    ok("RBAC: un vendedor no puede ajustar inventario (validado en backend)");

    const audits = await prisma.auditLog.count({ where: { organizationId: org.id } });
    assert.ok(audits >= 10);
    ok(`Auditoría registrada (${audits} eventos)`);

    console.log(`\n✅ Flujo E2E completo: ${step} verificaciones OK`);
  } finally {
    // Limpieza de la organización de prueba
    const where = { organizationId: org.id };
    await prisma.auditLog.deleteMany({ where });
    await prisma.notification.deleteMany({ where });
    await prisma.counter.deleteMany({ where });
    await prisma.cashMovement.deleteMany({ where });
    await prisma.payment.deleteMany({ where });
    await prisma.invoice.deleteMany({ where });
    await prisma.accountPayable.deleteMany({ where });
    await prisma.goodsReceipt.deleteMany({ where });
    await prisma.purchaseOrder.deleteMany({ where });
    await prisma.purchaseRequirement.deleteMany({ where });
    await prisma.salesOrder.deleteMany({ where });
    await prisma.quotation.deleteMany({ where });
    await prisma.customer.deleteMany({ where });
    await prisma.inventoryMovement.deleteMany({ where });
    await prisma.inventoryBalance.deleteMany({ where });
    await prisma.supplierProduct.deleteMany({ where });
    await prisma.supplier.deleteMany({ where });
    await prisma.product.deleteMany({ where });
    await prisma.warehouse.deleteMany({ where });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("\n❌ Falló el flujo E2E:", e);
  process.exit(1);
});
