import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { PageHeader, Card, Badge } from "@/components/ui";
import { Chat } from "./Chat";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Inteligencia IA" };

export default async function AIPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { ctx } = await requireSession("ia");
  const { q } = await searchParams;
  const actions = await prisma.aIAction.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 12 });
  const claude = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) && process.env.COPILOT_MODE !== "local";
  return (
    <div>
      <PageHeader
        title="Copiloto LatinSoft IA"
        subtitle="La base de datos y las reglas de negocio determinan los números; la IA interpreta, explica y propone."
        actions={<Badge tone={claude ? "ai" : "neutral"}>{claude ? "Motor: Claude (Anthropic)" : "Motor: local determinístico"}</Badge>}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Chat initialQuestion={q} />
        <div className="space-y-4">
          <Card title="Qué puede hacer">
            <ul className="space-y-2 text-[13px] text-ink-700">
              <li><Badge tone="success">Nivel 1</Badge> Consultas: stock, ventas, rotación, márgenes, proveedores (sin confirmación).</li>
              <li><Badge tone="warning">Nivel 2</Badge> Borradores: cotizaciones y necesidades de compra (no se envían solas).</li>
              <li><Badge tone="danger">Nivel 3</Badge> Acciones críticas (confirmar pedidos, enviar OC, recibir, pagar): siempre las aprueba usted en pantalla.</li>
            </ul>
          </Card>
          <Card title="Auditoría de la IA">
            {actions.length === 0 ? <p className="text-[13px] text-ink-500">Sin acciones registradas.</p> : (
              <ul className="space-y-2 text-[12px]">
                {actions.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2 border-b border-line-200 pb-2">
                    <span><code className="text-ai">{a.tool}</code><span className="block text-ink-500">{dateTime(a.createdAt)}</span></span>
                    {a.requiresConfirmation ? <Badge tone="warning">Borrador</Badge> : <Badge tone="success">Lectura</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
