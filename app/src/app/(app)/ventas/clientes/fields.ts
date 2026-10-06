import type { FieldDef } from "@/components/EntityForm";

export function customerFields(priceLists: { id: string; name: string }[]): FieldDef[] {
  return [
    { name: "documentType", label: "Tipo documento", type: "select", options: ["NIT", "CC", "CE", "PAS"].map((v) => ({ value: v, label: v })) },
    { name: "documentNumber", label: "Documento / NIT", required: true },
    { name: "name", label: "Razón social / nombre", required: true },
    { name: "tradeName", label: "Nombre comercial" },
    { name: "contactName", label: "Contacto" },
    { name: "phone", label: "Teléfono / WhatsApp" },
    { name: "email", label: "Email", type: "email" },
    { name: "city", label: "Ciudad" },
    { name: "address", label: "Dirección" },
    { name: "priceListId", label: "Lista de precios", type: "select", options: priceLists.map((p) => ({ value: p.id, label: p.name })) },
    { name: "creditLimit", label: "Cupo de crédito", type: "number", step: 1000 },
    { name: "creditDays", label: "Plazo (días)", type: "number", step: 1 },
  ];
}

export const customerSections = [
  { title: "Identificación", fields: ["documentType", "documentNumber", "name", "tradeName"] },
  { title: "Contacto", fields: ["contactName", "phone", "email", "city", "address"] },
  { title: "Condiciones comerciales", fields: ["priceListId", "creditLimit", "creditDays"] },
];
