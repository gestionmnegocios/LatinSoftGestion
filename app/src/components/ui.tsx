import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Tone } from "@/lib/format";

const TONES: Record<Tone, string> = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning-ink",
  danger: "bg-danger-bg text-danger",
  info: "bg-brand-100 text-brand-600",
  neutral: "bg-surface-100 text-ink-700",
  ai: "bg-ai-bg text-ai",
  brand: "bg-brand-100 text-navy-800",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: Tone }>; value: string }) {
  const s = map[value] ?? { label: value, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-xs font-medium text-brand-600 hover:underline">
            ← {back.label}
          </Link>
        )}
        <h1 className="h1">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </div>
  );
}

const ICON_TONES: Record<string, string> = {
  green: "bg-success-bg text-success",
  blue: "bg-brand-100 text-brand-600",
  orange: "bg-warning-bg text-warning",
  red: "bg-danger-bg text-danger",
  purple: "bg-ai-bg text-ai",
};

export function KpiCard({
  label, value, icon: Icon, tone = "blue", trend, href, hint,
}: { label: string; value: string; icon: LucideIcon; tone?: keyof typeof ICON_TONES; trend?: number | null; href?: string; hint?: string }) {
  const body = (
    <div className="card flex h-full items-start gap-3 p-4 transition-shadow hover:shadow-md">
      <div className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", ICON_TONES[tone])}>
        <Icon size={22} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-ink-500">{label}</div>
        <div className="num mt-0.5 text-[22px] font-bold leading-tight text-ink-950">{value}</div>
        {trend !== undefined && trend !== null && (
          <div className={clsx("mt-1 flex items-center gap-0.5 text-xs font-semibold", trend >= 0 ? "text-success" : "text-danger")}>
            {trend >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {Math.abs(trend).toFixed(0)}% <span className="font-normal text-ink-500">vs. periodo anterior</span>
          </div>
        )}
        {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx("card", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-line-200 px-4 py-3">
          <h2 className="h3">{title}</h2>
          {actions}
        </div>
      )}
      <div className={clsx(bodyClassName ?? "p-4")}>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-[13px] text-ink-500">{children}</div>;
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={clsx(
            "rounded-lg border px-3 py-1.5 text-[13px] font-medium",
            t.key === active ? "border-brand-500 bg-brand-100 text-brand-600" : "border-line-200 bg-white text-ink-700 hover:bg-surface-100",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1 opacity-80">({t.count})</span>}
        </Link>
      ))}
    </div>
  );
}

export function Stat({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={clsx("flex items-center justify-between py-1.5", strong ? "border-t border-line-200 pt-2.5 text-[15px] font-bold" : "text-[13px]")}>
      <span className={strong ? "" : "text-ink-500"}>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Pagination({ page, pages, total, shown, makeHref }: { page: number; pages: number; total: number; shown: number; makeHref: (p: number) => string }) {
  if (pages <= 1) return <div className="px-4 py-3 text-xs text-ink-500">Mostrando {shown} de {total}</div>;
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 2);
  return (
    <div className="flex items-center justify-between px-4 py-3 text-xs text-ink-500">
      <span>Mostrando {shown} de {total}</span>
      <div className="flex items-center gap-1">
        {nums.map((p, i) => (
          <span key={p} className="flex items-center gap-1">
            {i > 0 && nums[i - 1] !== p - 1 && <span>…</span>}
            <Link href={makeHref(p)} className={clsx("flex h-7 min-w-7 items-center justify-center rounded-md px-2 font-semibold", p === page ? "bg-brand-600 text-white" : "hover:bg-surface-100")}>
              {p}
            </Link>
          </span>
        ))}
      </div>
    </div>
  );
}
