import { prisma } from "./db";
import { getStockStatus } from "./services/inventory";

export type ProductOption = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  taxRate: number;
  salePrice: number;
  averageCost: number;
  prices: Record<string, number>;
  onHand: number;
  reserved: number;
  available: number;
  minimumStock: number;
  status: string;
};

export async function getProductOptions(orgId: string, warehouseId: string): Promise<ProductOption[]> {
  const products = await prisma.product.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    include: { prices: true, balances: { where: { warehouseId } } },
    orderBy: { name: "asc" },
  });
  return products.map((p) => {
    const b = p.balances[0];
    const onHand = b?.onHand ?? 0;
    const reserved = b?.reserved ?? 0;
    return {
      id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, unit: p.unit, taxRate: p.taxRate, salePrice: p.salePrice, averageCost: p.averageCost,
      prices: Object.fromEntries(p.prices.map((x) => [x.priceListId, x.price])),
      onHand, reserved, available: onHand - reserved, minimumStock: p.minimumStock,
      status: getStockStatus({ onHand, reserved, minimumStock: p.minimumStock, maximumStock: p.maximumStock }),
    };
  });
}
