import { prisma } from "@/server/db";
import { Logo } from "./Logo";

/** Encabezado de documento imprimible (cotización, pedido, OC, factura). */
export async function DocHeader({ orgId, title, number, status }: { orgId: string; title: string; number: string; status?: React.ReactNode }) {
  const company = await prisma.company.findFirst({ where: { organizationId: orgId } });
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line-200 pb-4">
      <div>
        <Logo dark size={18} />
        <div className="mt-2 text-[13px] font-semibold">{company?.legalName}</div>
        <div className="text-xs text-ink-500">NIT {company?.taxId} · {company?.address} · {company?.phone}</div>
      </div>
      <div className="text-right">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</div>
        <div className="text-[20px] font-bold">{number}</div>
        {status && <div className="mt-1">{status}</div>}
      </div>
    </div>
  );
}
