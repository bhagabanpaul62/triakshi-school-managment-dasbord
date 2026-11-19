import Link from "next/link";
import { cn } from "@smw/ui/utils";

/** Tabs that live in the URL (`?tab=`), so each one is a normal server render. */
export function TabLinks({ base, active, tabs }: { base: string; active: string; tabs: { id: string; label: string; count?: number }[] }) {
  return (
    <nav aria-label="Sections" className="custom-scrollbar flex gap-1 overflow-x-auto rounded-full bg-white/[0.04] p-1">
      {tabs.map((t) => (
        <Link key={t.id} href={`${base}?tab=${t.id}`} aria-current={active === t.id ? "page" : undefined} scroll={false}
          className={cn("flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm transition-colors duration-150",
            active === t.id ? "bg-white/[0.1] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]")}>
          {t.label}
          {t.count ? <span className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
