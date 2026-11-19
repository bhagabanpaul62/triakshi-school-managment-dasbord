import type { ReactNode } from "react";

/** Page title row: optional eyebrow, the title, one line of context, actions on the right. */
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pb-8 pt-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{eyebrow}</p> : null}
        <h1 className="mt-1 text-[28px] font-medium tracking-tight text-[var(--ds-on-surface)]">{title}</h1>
        {description ? <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** KPI row: 2-up on phones, up to 4 across. Put StatCards inside. */
export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 pb-8 lg:grid-cols-4">{children}</div>;
}

/** The 12-column panel grid. Children set their own `lg:col-span-*`. */
export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">{children}</div>;
}
