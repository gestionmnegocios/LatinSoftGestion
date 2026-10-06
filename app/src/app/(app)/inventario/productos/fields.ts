import type { FieldDef } from "@/components/EntityForm";

export function productFields(categories: { id: string; name: string; parent?: { name: string } | null }[], isNew: boolean): FieldDef[] {
  return [
    { name: "sku", label: "SKU (código interno)", required: true },
    { name: "barcode", label: "Código de barras (EAN/UPC)" },
    { name: "name", label: "Nombre", required: true },
    { name: "categoryId", label: "Categoría", type: "select", options: [{ value: "", label: "Sin categoría" }, ...categories.map((c) => ({ value: c.id, label: c.parent ? `${c.parent.name} › ${c.name}` : c.name }))] },
    { name: "unit", label: "Unidad", type: "select", options: ["UND", "PAQ", "CAJA", "GAL", "KG", "LT", "MT"].map((v) => ({ value: v, label: v })) },
    { name: "description", label: "Descripción", type: "textarea", span: 3 },
    ...(isNew ? [{ name: "averageCost", label: "Costo inicial", type: "number", step: 50, help: "Luego se recalcula con cada compra (promedio ponderado)." } as FieldDef] : []),
    { name: "salePrice", label: "Precio de venta", type: "number", step: 50, required: true },
    { name: "taxRate", label: "IVA %", type: "number", step: 1 },
    { name: "minimumStock", label: "Stock mínimo", type: "number", step: 1 },
    { name: "safetyStock", label: "Stock de seguridad", type: "number", step: 1 },
    { name: "maximumStock", label: "Stock máximo", type: "number", step: 1 },
    { name: "location", label: "Ubicación en bodega", placeholder: "Ej: A-03" },
    { name: "trackLot", label: "Controla lote", type: "checkbox" },
    { name: "trackExpiration", label: "Controla vencimiento", type: "checkbox" },
    { name: "status", label: "Estado", type: "select", options: [{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }] },
  ];
}

export function productSections(isNew: boolean) {
  return [
    { title: "Identificación", fields: ["sku", "barcode", "name", "categoryId", "unit", "status", "description"] },
    { title: "Comercial", fields: [...(isNew ? ["averageCost"] : []), "salePrice", "taxRate"] },
    { title: "Política de inventario y logística", fields: ["minimumStock", "safetyStock", "maximumStock", "location", "trackLot", "trackExpiration"] },
  ];
}
