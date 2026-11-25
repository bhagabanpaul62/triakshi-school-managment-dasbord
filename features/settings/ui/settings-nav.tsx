"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChevronLeft, IconChevronRight, IconSearch } from "@tabler/icons-react";
import { cn } from "@smw/ui/utils";
import type { NavGroup } from "./nav";

/**
 * The Settings side list with a search box that filters it. On a phone it is the Settings page itself (`/app/settings`),
 * and a sub page shows only its own content with a back link, so one screen never holds both.
 */
export function SettingsNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const [q, setQ] = useState("");
  const word = q.trim().toLowerCase();
  const shown = groups.map((g) => ({ ...g, items: g.items.filter((i) => !word || `${i.label} ${i.hint}`.toLowerCase().includes(word)) })).filter((g) => g.items.length);
  const home = path === "/app/settings";
  return (
    <nav aria-label="Settings" className={cn("flex-col gap-4 lg:flex lg:w-64 lg:shrink-0", home ? "flex" : "hidden")}>
      <label className="flex h-10 items-center gap-2 rounded-full bg-white/[0.05] px-4">
        <IconSearch className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />
        <span className="sr-only">Search settings</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ds-on-surface-muted)]" />
      </label>
      {shown.length === 0 ? <p className="px-2 text-sm text-[var(--ds-on-surface-muted)]">Nothing matches &ldquo;{q}&rdquo;. Try a shorter word, like users or export.</p> : null}
      {shown.map((g) => (
        <div key={g.key}>
          <p className="px-2 pb-1 font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{g.label}</p>
          <ul className="flex flex-col">
            {g.items.map((i) => {
              const active = path === i.href || path.startsWith(`${i.href}/`);
              return (
                <li key={i.href}>
                  <Link href={i.href} aria-current={active ? "page" : undefined}
                    className={cn("flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]", active ? "bg-white/[0.09] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-variant)] hover:bg-white/[0.05]")}>
                    <span className="min-w-0"><span className="block truncate">{i.label}</span><span className="block truncate text-xs text-[var(--ds-on-surface-muted)] lg:hidden">{i.hint}</span></span>
                    <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)] lg:hidden" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Phone only: the way back to the area list, hidden on the list itself. */
export function BackToSettings() {
  if (usePathname() === "/app/settings") return null;
  return <Link href="/app/settings" className="mb-3 inline-flex min-h-10 items-center gap-1 text-[13px] text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)] lg:hidden"><IconChevronLeft className="h-4 w-4" aria-hidden />Settings</Link>;
}
