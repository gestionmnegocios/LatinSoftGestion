/* Copiloto LatinSoft IA — orquestador (Arq. §32).
 * Modo "claude": si hay credenciales de Anthropic, Claude interpreta la pregunta y llama herramientas.
 * Modo "local": un enrutador determinístico de intenciones usa las mismas herramientas.
 * En ambos casos los números provienen del backend, nunca del modelo. */
import Anthropic from "@anthropic-ai/sdk";
import { prisma, type Ctx } from "../db";
import * as T from "./tools";
import { fold as norm } from "@/lib/text";

export type CopilotAnswer = {
  text: string;
  actions: { label: string; href: string }[];
  tools: string[];
  mode: "claude" | "local";
};

type ToolDef = {
  name: string;
  level: 1 | 2;
  description: string;
  input_schema: Anthropic.Beta.BetaTool.InputSchema;
  run: (ctx: Ctx, input: any) => Promise<T.ToolResult>;
};

const TOOLS: ToolDef[] = [
  {
    name: "get_inventory_summary", level: 1,
    description: "Resumen del inventario de la bodega actual: valor valorizado al costo promedio, productos con stock bajo, agotados, sobreinventario y valor inmovilizado sin ventas en 90 días.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: (ctx) => T.getInventorySummary(ctx),
  },
  {
    name: "get_low_stock_products", level: 1,
    description: "Productos agotados, con stock bajo o que podrían agotarse en N días según el ritmo de ventas de los últimos 30 días.",
    input_schema: { type: "object", properties: { days: { type: "integer", description: "Horizonte en días (por defecto 7)" } }, additionalProperties: false },
    run: (ctx, i) => T.getLowStockProducts(ctx, i?.days ?? 7),
  },
  {
    name: "get_stale_products", level: 1,
    description: "Productos sin ventas o con muy baja rotación en los últimos N días y el valor inmovilizado.",
    input_schema: { type: "object", properties: { days: { type: "integer", description: "Periodo en días (por defecto 90)" } }, additionalProperties: false },
    run: (ctx, i) => T.getStaleProducts(ctx, i?.days ?? 90),
  },
  {
    name: "get_top_margin_products", level: 1,
    description: "Productos con mayor margen porcentual (precio de venta vs costo promedio).",
    input_schema: { type: "object", properties: { limit: { type: "integer" } }, additionalProperties: false },
    run: (ctx, i) => T.getTopMarginProducts(ctx, i?.limit ?? 8),
  },
  {
    name: "get_sales_summary", level: 1,
    description: "Resumen de ventas de los últimos N días: pedidos, ingresos antes de IVA, margen bruto, ticket promedio, productos y clientes principales.",
    input_schema: { type: "object", properties: { days: { type: "integer" } }, additionalProperties: false },
    run: (ctx, i) => T.getSalesSummary(ctx, i?.days ?? 30),
  },
  {
    name: "get_product_stock", level: 1,
    description: "Existencia física, comprometida, disponible, en tránsito y proyectada de productos que coinciden con un nombre o SKU.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    run: (ctx, i) => T.getProductStock(ctx, String(i.query)),
  },
  {
    name: "calculate_purchase_requirement", level: 1,
    description: "Ejecuta el motor determinístico de reposición para cubrir N días: cantidades sugeridas, motivo y costo estimado. No crea nada.",
    input_schema: { type: "object", properties: { horizon_days: { type: "integer" } }, additionalProperties: false },
    run: (ctx, i) => T.calculatePurchaseRequirement(ctx, i?.horizon_days ?? 30),
  },
  {
    name: "get_supplier_options", level: 1,
    description: "Proveedores disponibles con precios relativos, tiempos de entrega, crédito, transporte y cumplimiento; opcionalmente filtrado por producto.",
    input_schema: { type: "object", properties: { product_query: { type: "string" } }, additionalProperties: false },
    run: (ctx, i) => T.getSupplierOptions(ctx, i?.product_query),
  },
  {
    name: "create_quote_draft", level: 2,
    description: "Crea una COTIZACIÓN EN BORRADOR (no se envía ni reserva inventario) para un cliente con productos y cantidades.",
    input_schema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Nombre del cliente" },
        items: { type: "array", items: { type: "object", properties: { product: { type: "string" }, quantity: { type: "number" } }, required: ["product", "quantity"], additionalProperties: false } },
      },
      required: ["customer", "items"],
      additionalProperties: false,
    },
    run: (ctx, i) => T.createQuoteDraft(ctx, String(i.customer), i.items ?? []),
  },
  {
    name: "create_purchase_draft", level: 2,
    description: "Crea una NECESIDAD DE COMPRA en borrador con las cantidades del motor de reposición para N días. No emite órdenes de compra.",
    input_schema: { type: "object", properties: { horizon_days: { type: "integer" } }, additionalProperties: false },
    run: (ctx, i) => T.createPurchaseDraft(ctx, i?.horizon_days ?? 30),
  },
];

async function runTool(ctx: Ctx, name: string, input: unknown, conversationId?: string) {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`Herramienta desconocida: ${name}`);
  if (def.level === 2 && !ctx.permissions.has("*") && !ctx.permissions.has(name === "create_quote_draft" ? "sales.quote.create" : "purchase.create")) {
    return { data: { error: "forbidden" }, summary: "No tienes permiso para crear este borrador." } as T.ToolResult;
  }
  const result = await def.run(ctx, input);
  await prisma.aIAction.create({
    data: {
      organizationId: ctx.orgId, userId: ctx.userId, conversationId, tool: name,
      input: JSON.stringify(input ?? {}), output: JSON.stringify(result.data).slice(0, 4000),
      requiresConfirmation: def.level >= 2,
    },
  });
  return result;
}

// ───────────────────────── Modo local (determinístico) ─────────────────────────

function parseDays(q: string, fallback: number) {
  const m = q.match(/(\d+)\s*dias?/);
  if (m) return Number(m[1]);
  if (/semana/.test(q)) return 7;
  if (/mes/.test(q)) return 30;
  return fallback;
}

function bullets(rows: string[], max = 8) {
  const list = rows.slice(0, max).map((r) => `• ${r}`);
  if (rows.length > max) list.push(`• … y ${rows.length - max} más`);
  return list.join("\n");
}

const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");

async function localAnswer(ctx: Ctx, question: string): Promise<CopilotAnswer> {
  const q = norm(question);
  const used: string[] = [];
  const call = async (name: string, input: unknown) => { used.push(name); return runTool(ctx, name, input); };
  const done = (text: string, r?: T.ToolResult): CopilotAnswer => ({ text, actions: r?.link ? [r.link] : [], tools: used, mode: "local" });

  // Acción: crear cotización ("Cotiza 30 detergentes para Hotel Central")
  const cot = q.match(/cotiz\w*\s+(.+?)\s+(?:para|a)\s+(?:el |la |los )?(.+)$/);
  if (cot) {
    const items = cot[1].split(/,|\sy\s/).map((s) => s.trim()).map((s) => {
      const m = s.match(/^(\d+(?:[.,]\d+)?)\s+(?:de\s+)?(.+)$/);
      return m ? { product: m[2], quantity: Number(m[1].replace(",", ".")) } : null;
    }).filter(Boolean) as { product: string; quantity: number }[];
    if (items.length) {
      const r = await call("create_quote_draft", { customer: cot[2], items });
      return done(r.summary, r);
    }
  }
  if (/(genera|generar|crea|crear|arma|armar|haz)\b.*(compra|propuesta|pedido a proveedor)/.test(q) || /propuesta de compra/.test(q)) {
    const r = await call("create_purchase_draft", { horizon_days: parseDays(q, 30) });
    return done(r.summary, r);
  }
  if (/(debo|deberia|necesito|que)\s+(comprar|reponer)|reposicion|necesidad(es)? de compra/.test(q)) {
    const days = parseDays(q, 30);
    const r = await call("calculate_purchase_requirement", { horizon_days: days });
    const d = r.data as { items: { name: string; suggested_quantity: number; reason: string; estimated_cost: number }[] };
    const reason: Record<string, string> = { OUT_OF_STOCK: "agotado", SALES_ORDER: "faltante en pedidos", LOW_STOCK: "bajo mínimo", FORECAST: "demanda prevista" };
    return done(`${r.summary}\n${bullets(d.items.map((i) => `${i.name}: comprar ${i.suggested_quantity} (${reason[i.reason]}) ≈ ${money(i.estimated_cost)}`))}`, r);
  }
  if (/agot|stock bajo|critic|por debajo|minimo|quiebre/.test(q)) {
    const r = await call("get_low_stock_products", { days: parseDays(q, 7) });
    const d = r.data as { name: string; available: number; days_of_coverage: number; incoming: number }[];
    return done(`${r.summary}\n${bullets(d.map((i) => `${i.name}: disponible ${i.available}${i.available > 0 ? `, alcanza ~${i.days_of_coverage >= 999 ? "∞" : Math.floor(i.days_of_coverage)} días` : " (agotado)"}${i.incoming ? `, ${i.incoming} en tránsito` : ""}`))}`, r);
  }
  if (/no se venden|sin venta|sin movimiento|inmoviliz|rotacion|quieto/.test(q)) {
    const r = await call("get_stale_products", { days: parseDays(q, 90) });
    const d = r.data as { name: string; on_hand: number; value: number; coverage_days: number | null }[];
    return done(`${r.summary}\n${bullets(d.map((i) => `${i.name}: ${i.on_hand} und, ${money(i.value)}${i.coverage_days ? `, cobertura ${i.coverage_days} días` : ", sin ventas"}`))}`, r);
  }
  if (/valoriz|cuanto vale|valor del inventario|resumen.*inventario|estado del inventario/.test(q)) {
    const r = await call("get_inventory_summary", {});
    return done(r.summary, r);
  }
  if (/margen|rentab/.test(q)) {
    const r = await call("get_top_margin_products", { limit: 8 });
    const d = r.data as { name: string; margin_pct: number; unit_margin: number }[];
    return done(`Productos con mayor margen:\n${bullets(d.map((i) => `${i.name}: ${i.margin_pct.toFixed(1)}% (${money(i.unit_margin)} por unidad)`))}`, r);
  }
  if (/proveedor/.test(q)) {
    const m = q.match(/(?:para|de)\s+(?:el |la |los |las )?([a-z0-9 ]{3,})\??$/);
    const r = await call("get_supplier_options", { product_query: m && !/proveedor/.test(m[1]) ? m[1].replace(/s$/, "") : undefined });
    const d = r.data as { suppliers: { name: string; avg_price_index: number; lead_time: number; credit_days: number; shipping: number; rating: number }[] };
    const ranked = [...d.suppliers].sort((a, b) => (b.rating / 5 * 0.15 + 0.25 / Math.max(1, b.lead_time) + 0.4 / b.avg_price_index + b.credit_days / 300) - (a.rating / 5 * 0.15 + 0.25 / Math.max(1, a.lead_time) + 0.4 / a.avg_price_index + a.credit_days / 300));
    return done(
      `La conveniencia depende de la compra concreta (cobertura, transporte y plazos), no solo del precio. Panorama general:\n${bullets(ranked.map((s) => `${s.name}: precio ${s.avg_price_index < 1 ? `${((1 - s.avg_price_index) * 100).toFixed(1)}% bajo` : `${((s.avg_price_index - 1) * 100).toFixed(1)}% sobre`} el costo promedio, entrega ${s.lead_time} días, crédito ${s.credit_days} días, transporte ${money(s.shipping)}, cumplimiento ${s.rating}/5`))}\nPara una recomendación exacta, genera una necesidad de compra y usa el comparador.`,
      r,
    );
  }
  if (/venta|vendi|vendido|factur|ingreso/.test(q)) {
    const r = await call("get_sales_summary", { days: parseDays(q, 30) });
    const d = r.data as { top_products: { name: string; qty: number }[]; top_customers: { name: string; revenue: number }[] };
    return done(`${r.summary}\nTop productos:\n${bullets(d.top_products.map((p) => `${p.name}: ${p.qty} und`), 5)}\nTop clientes:\n${bullets(d.top_customers.map((c) => `${c.name}: ${money(c.revenue)}`), 3)}`, r);
  }
  const stockQ = q.match(/(?:stock|existencia|disponib\w*|inventario|cuant[oa]s?\s+\w+\s+(?:hay|tengo|quedan))\s+(?:de|del|hay de)?\s*(.+?)\??$/) ?? q.match(/cuant[oa]s?\s+(.+?)\s+(?:hay|tengo|quedan)/);
  if (stockQ) {
    const r = await call("get_product_stock", { query: stockQ[1].replace(/s\b/g, "").trim() });
    return done(r.summary, r);
  }
  return {
    text: "Puedo ayudarte con preguntas como:\n• ¿Qué debo comprar esta semana?\n• Muéstrame productos próximos a agotarse\n• ¿Qué productos no se venden hace 90 días?\n• ¿Cuál es mi inventario valorizado?\n• ¿Qué productos tienen mayor margen?\n• Genera una propuesta de compra para los próximos 30 días\n• Cotiza 30 detergentes para Hotel Central",
    actions: [],
    tools: used,
    mode: "local",
  };
}

// ───────────────────────── Modo Claude ─────────────────────────

const SYSTEM_PROMPT = `Eres el Copiloto de LatinSoftGestion, un sistema de gestión comercial, inventario y compras para pequeñas empresas en Colombia.
Respondes en español, de forma breve y accionable, en pesos colombianos con formato $1.234.567.
Reglas:
- Los números (existencias, costos, totales, cantidades sugeridas) provienen SOLO de las herramientas. Nunca inventes ni estimes cifras por tu cuenta.
- Para preguntas, usa herramientas de consulta. Solo crea borradores (cotización o necesidad de compra) cuando el usuario lo pida explícitamente.
- Los borradores nunca envían ni confirman nada: indica que el usuario debe revisarlos y aprobarlos.
- No recomiendes automáticamente al proveedor más barato: considera entrega, crédito, transporte, cobertura y cumplimiento.
- Si una herramienta no devuelve datos suficientes, dilo.
- Usa viñetas cortas cuando listes productos. No uses tablas markdown ni encabezados.`;

function hasClaudeCredentials() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) && process.env.COPILOT_MODE !== "local";
}

async function claudeAnswer(ctx: Ctx, question: string, history: { role: "user" | "assistant"; content: string }[]): Promise<CopilotAnswer> {
  const client = new Anthropic();
  const tools: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];
  const used: string[] = [];
  const actions: CopilotAnswer["actions"] = [];
  const conversationId = `c-${Date.now()}`;

  for (let turn = 0; turn < 6; turn++) {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
    if (response.stop_reason === "refusal") {
      return { text: "No puedo ayudar con esa solicitud.", actions, tools: used, mode: "claude" };
    }
    if (response.stop_reason !== "tool_use") {
      const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { text: text || "Listo.", actions, tools: used, mode: "claude" };
    }
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      used.push(block.name);
      try {
        const r = await runTool(ctx, block.name, block.input, conversationId);
        if (r.link && !actions.some((a) => a.href === r.link!.href)) actions.push(r.link);
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify({ summary: r.summary, data: r.data }) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: `Error: ${(e as Error).message}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "La consulta requirió demasiados pasos; intenta una pregunta más concreta.", actions, tools: used, mode: "claude" };
}

export async function askCopilot(ctx: Ctx, question: string, history: { role: "user" | "assistant"; content: string }[] = []): Promise<CopilotAnswer> {
  const q = question.trim().slice(0, 1000);
  if (!q) return { text: "Escribe una pregunta.", actions: [], tools: [], mode: "local" };
  if (hasClaudeCredentials()) {
    try {
      return await claudeAnswer(ctx, q, history);
    } catch (e) {
      const local = await localAnswer(ctx, q);
      const reason = e instanceof Anthropic.AuthenticationError ? "credenciales inválidas" : e instanceof Anthropic.RateLimitError ? "límite de uso" : e instanceof Anthropic.APIError ? `error ${e.status}` : "sin conexión";
      return { ...local, text: `${local.text}\n\n(Respondido con el motor local: Claude no disponible — ${reason}.)` };
    }
  }
  return localAnswer(ctx, q);
}

/** Tarjeta del Dashboard: situaciones que requieren atención (PRD §6). */
export async function getCopilotHighlights(ctx: Ctx) {
  const low = await T.getLowStockProducts(ctx, 7);
  const list = low.data as { status: string; days_of_coverage: number; available: number }[];
  const out = list.filter((x) => x.status === "OUT_OF_STOCK").length;
  const soon = list.filter((x) => x.available > 0 && x.days_of_coverage <= 7).length;
  const belowMin = list.filter((x) => x.status === "LOW").length;
  const stale = await T.getStaleProducts(ctx, 90);
  const staleValue = (stale.data as { value: number }[]).reduce((s, x) => s + x.value, 0);
  return { attention: list.length, soon, out, belowMin, staleValue, staleCount: (stale.data as unknown[]).length };
}
