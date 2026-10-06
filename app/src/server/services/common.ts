import type { Ctx, Tx } from "../db";

const YEAR = 2026;

/** Numeración consecutiva por tenant: COT-2026-00124, PED-2026-00871, OC-2026-0001 ... */
export async function nextNumber(tx: Tx, orgId: string, prefix: string, pad = 5) {
  const key = `${prefix}-${YEAR}`;
  const c = await tx.counter.upsert({
    where: { organizationId_key: { organizationId: orgId, key } },
    create: { organizationId: orgId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${YEAR}-${String(c.value).padStart(pad, "0")}`;
}

export async function audit(
  tx: Tx,
  ctx: Ctx,
  action: string,
  entity: string,
  entityId: string | null,
  oldValue?: unknown,
  newValue?: unknown,
) {
  await tx.auditLog.create({
    data: {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      userName: ctx.userName,
      action,
      entity,
      entityId,
      oldValue: oldValue === undefined ? null : JSON.stringify(oldValue),
      newValue: newValue === undefined ? null : JSON.stringify(newValue),
    },
  });
}

export async function notify(
  tx: Tx,
  orgId: string,
  type: string,
  title: string,
  message: string,
  link?: string,
) {
  await tx.notification.create({ data: { organizationId: orgId, type, title, message, link } });
}
