export function money(n: number | null | undefined) {
  const v = Math.round(n ?? 0);
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("es-CO");
}

export function num(n: number | null | undefined, digits = 0) {
  return (n ?? 0).toLocaleString("es-CO", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function pct(n: number, digits = 1) {
  return `${n.toLocaleString("es-CO", { maximumFractionDigits: digits })}%`;
}

const TZ = "America/Bogota";

export function date(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
}

export function dateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function shortDate(d: Date | string) {
  return new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "short", timeZone: TZ });
}

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "ai" | "brand";

export const STOCK_STATUS: Record<string, { label: string; tone: Tone }> = {
  NORMAL: { label: "Normal", tone: "success" },
  LOW: { label: "Bajo", tone: "warning" },
  OUT_OF_STOCK: { label: "Agotado", tone: "danger" },
  OVERSTOCK: { label: "Sobrestock", tone: "info" },
};

export const QUOTE_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Borrador", tone: "warning" },
  SENT: { label: "Enviada", tone: "info" },
  ACCEPTED: { label: "Aceptada", tone: "success" },
  REJECTED: { label: "Rechazada", tone: "danger" },
  EXPIRED: { label: "Vencida", tone: "neutral" },
  CONVERTED: { label: "Convertida", tone: "success" },
};

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Borrador", tone: "neutral" },
  CONFIRMED: { label: "Confirmado", tone: "info" },
  PREPARING: { label: "Preparación", tone: "brand" },
  PARTIAL: { label: "Parcial", tone: "warning" },
  READY: { label: "Listo", tone: "success" },
  DISPATCHED: { label: "Despachado", tone: "success" },
  DELIVERED: { label: "Entregado", tone: "neutral" },
  CANCELLED: { label: "Cancelado", tone: "danger" },
};

export const PO_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Borrador", tone: "neutral" },
  PENDING_APPROVAL: { label: "Por aprobar", tone: "warning" },
  APPROVED: { label: "Aprobada", tone: "info" },
  SENT: { label: "Enviada", tone: "info" },
  CONFIRMED: { label: "Confirmada", tone: "brand" },
  IN_TRANSIT: { label: "En tránsito", tone: "warning" },
  PARTIALLY_RECEIVED: { label: "Recibida parcial", tone: "warning" },
  RECEIVED: { label: "Recibida", tone: "success" },
  CLOSED: { label: "Cerrada", tone: "neutral" },
  CANCELLED: { label: "Cancelada", tone: "danger" },
};

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  ISSUED: { label: "Pendiente", tone: "warning" },
  PARTIAL: { label: "Abono", tone: "info" },
  PAID: { label: "Pagada", tone: "success" },
  OVERDUE: { label: "Vencida", tone: "danger" },
  CANCELLED: { label: "Anulada", tone: "danger" },
};

export const REASON_LABEL: Record<string, string> = {
  OUT_OF_STOCK: "Agotado",
  SALES_ORDER: "Pedido con faltante",
  LOW_STOCK: "Bajo mínimo",
  FORECAST: "Demanda prevista",
  MANUAL: "Manual",
};
