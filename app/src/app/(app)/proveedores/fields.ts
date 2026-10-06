import type { FieldDef } from "@/components/EntityForm";

export const supplierFields: FieldDef[] = [
  { name: "taxId", label: "NIT", required: true },
  { name: "legalName", label: "Razón social", required: true },
  { name: "tradeName", label: "Nombre comercial" },
  { name: "contactName", label: "Contacto" },
  { name: "phone", label: "Teléfono / WhatsApp" },
  { name: "email", label: "Email", type: "email" },
  { name: "city", label: "Ciudad" },
  { name: "address", label: "Dirección", span: 2 },
  { name: "paymentTerms", label: "Condiciones de pago", type: "select", options: ["Contado", "Crédito", "Anticipo"].map((v) => ({ value: v, label: v })) },
  { name: "creditDays", label: "Días de crédito", type: "number", step: 1 },
  { name: "averageLeadTime", label: "Tiempo de entrega (días)", type: "number", step: 1 },
  { name: "shippingCost", label: "Costo de transporte por pedido", type: "number", step: 1000, help: "0 = transporte incluido" },
  { name: "fulfillmentRating", label: "Calificación de cumplimiento (0-5)", type: "number", step: 0.1 },
];

export const supplierSections = [
  { title: "Identificación y contacto", fields: ["taxId", "legalName", "tradeName", "contactName", "phone", "email", "city", "address"] },
  { title: "Condiciones comerciales", fields: ["paymentTerms", "creditDays", "averageLeadTime", "shippingCost", "fulfillmentRating"] },
];
