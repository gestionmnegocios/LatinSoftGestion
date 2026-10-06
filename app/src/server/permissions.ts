/** Catálogo de permisos granulares (Arq. §6) y roles base (PRD §4, §30). */
export const PERMISSIONS: Record<string, string> = {
  "inventory.view": "Ver inventario",
  "inventory.adjust": "Ajustar inventario",
  "inventory.transfer": "Transferir entre bodegas",
  "inventory.receive": "Recibir mercancía",
  "products.manage": "Crear/editar productos",
  "sales.quote.create": "Crear cotizaciones",
  "sales.order.create": "Crear/cancelar pedidos",
  "sales.order.prepare": "Preparar pedidos",
  "sales.order.dispatch": "Despachar pedidos",
  "customers.manage": "Gestionar clientes",
  "purchase.create": "Crear compras y necesidades",
  "purchase.approve": "Aprobar/enviar OC",
  "suppliers.manage": "Gestionar proveedores",
  "finance.view_cost": "Ver costos y márgenes",
  "finance.invoice": "Facturar",
  "finance.receive_payment": "Registrar cobros",
  "finance.pay": "Pagar proveedores",
  "finance.cash": "Gestionar caja",
  "settings.manage": "Configuración y usuarios",
  "ai.use": "Usar Copiloto IA",
};

export const ROLE_TEMPLATES: { key: string; name: string; permissions: string[] }[] = [
  { key: "admin", name: "Administrador", permissions: ["*"] },
  {
    key: "sales",
    name: "Vendedor",
    permissions: ["inventory.view", "sales.quote.create", "sales.order.create", "customers.manage", "finance.invoice", "ai.use"],
  },
  {
    key: "warehouse",
    name: "Encargado de bodega",
    permissions: ["inventory.view", "inventory.adjust", "inventory.transfer", "inventory.receive", "products.manage", "sales.order.prepare", "sales.order.dispatch", "ai.use"],
  },
  {
    key: "purchasing",
    name: "Comprador",
    permissions: ["inventory.view", "purchase.create", "purchase.approve", "suppliers.manage", "finance.view_cost", "ai.use"],
  },
  { key: "cashier", name: "Caja", permissions: ["finance.invoice", "finance.receive_payment", "finance.cash", "finance.pay"] },
  { key: "viewer", name: "Consulta", permissions: ["inventory.view"] },
];

/** Acceso de lectura por módulo: basta con tener cualquiera de los permisos listados. */
export const MODULE_ACCESS: Record<string, string[]> = {
  ventas: ["sales.quote.create", "sales.order.create", "sales.order.prepare", "sales.order.dispatch", "finance.invoice", "finance.receive_payment"],
  inventario: ["inventory.view"],
  compras: ["purchase.create", "inventory.receive"],
  proveedores: ["suppliers.manage", "purchase.create"],
  finanzas: ["finance.cash", "finance.receive_payment", "finance.pay", "finance.view_cost"],
  reportes: ["finance.view_cost", "inventory.view"],
  ia: ["ai.use"],
};

export function hasAny(permissions: Set<string> | string[], required?: string[]) {
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  if (!required || set.has("*")) return true;
  return required.some((p) => set.has(p));
}
