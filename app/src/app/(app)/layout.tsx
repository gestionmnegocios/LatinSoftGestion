import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { Shell } from "@/components/Shell";
import { MODULE_ACCESS, hasAny } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const notifications = await prisma.notification.findMany({
    where: { organizationId: s.ctx.orgId },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  return (
    <Shell
      modules={Object.keys(MODULE_ACCESS).filter((m) => hasAny(s.ctx.permissions, MODULE_ACCESS[m]))}
      user={{ name: s.user.name, roles: s.user.roles }}
      orgName={s.org.name}
      warehouses={s.warehouses}
      warehouseId={s.ctx.warehouseId}
      notifications={notifications.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() }))}
    >
      {children}
    </Shell>
  );
}
