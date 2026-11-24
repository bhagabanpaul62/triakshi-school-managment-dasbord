"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconMenu2, IconX, IconLogout } from "@tabler/icons-react";
import { cn } from "../lib/utils";
import { initials } from "../lib/format";
import { MenuIconView } from "./icons";

export interface ShellNavItem { label: string; href: string; icon: string; badge?: number }
export interface ShellNavGroup { label: string; items: ShellNavItem[] }

export interface AppShellProps {
  brand: { name: string; logoUrl?: string | null; homeHref: string };
  groups: ShellNavGroup[];
  user: { name: string; meta: string; avatarUrl?: string | null };
  /** Server action that signs out. */
  logout: () => Promise<void>;
  topbar?: ReactNode;
  /** Shown across the top: support session, read-only school, trial ending. */
  banner?: ReactNode;
  children: ReactNode;
}

const matches = (path: string, href: string, home: string) => (href === home ? path === href : path === href || path.startsWith(href + "/"));

/** The panel frame shared by the school app and the console: sidebar, top bar, mobile drawer. */
export function AppShell({ brand, groups, user, logout, topbar, banner, children }: AppShellProps) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // One item lights up: the closest one ("Fee bills", not also "Fees" above it).
  const current = groups.flatMap((g) => g.items).filter((it) => matches(path, it.href, brand.homeHref)).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const nav = (
    <nav aria-label="Main" className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pb-6">
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1.5 font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{g.label}</p>
          {g.items.map((it) => {
            const active = it.href === current;
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]",
                  active ? "bg-white/[0.07] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-variant)] hover:bg-white/[0.04] hover:text-[var(--ds-on-surface)]",
                )}
              >
                <span className={active ? "text-[var(--ds-color-primary-400)]" : ""}><MenuIconView name={it.icon} /></span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.badge ? <span className="rounded-full bg-[var(--ds-color-primary-500)]/20 px-2 text-[11px] tabular-nums text-[var(--ds-color-primary-300)]">{it.badge}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const brandRow = (
    <Link href={brand.homeHref} className="flex items-center gap-3 px-6 py-5">
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--ds-color-primary-500)] text-sm font-medium text-white">{initials(brand.name)}</span>
      )}
      <span className="min-w-0 truncate text-[15px] font-medium text-[var(--ds-on-surface)]" title={brand.name}>{brand.name}</span>
    </Link>
  );

  const userRow = (
    <div className="flex items-center gap-3 px-6 py-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-xs text-[var(--ds-on-surface)]">{initials(user.name)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-[var(--ds-on-surface)]">{user.name}</p>
        <p className="truncate text-xs text-[var(--ds-on-surface-muted)]">{user.meta}</p>
      </div>
      <form action={logout}>
        <button type="submit" aria-label="Sign out" title="Sign out" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
          <IconLogout className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  );

  return (
    <div className="flex min-h-dvh bg-[var(--ds-color-background)] text-[var(--ds-on-surface)]">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-[var(--ds-surface-container-lowest)] lg:flex">
        {brandRow}
        {nav}
        {userRow}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-72 flex-col bg-[var(--ds-surface-container-lowest)]">
            <div className="flex items-center justify-between pr-4">{brandRow}
              <button onClick={() => setOpen(false)} aria-label="Close menu" title="Close menu" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06]"><IconX className="h-4 w-4" /></button>
            </div>
            {nav}
            {userRow}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {banner}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 bg-[var(--ds-color-background)]/95 px-4 sm:px-8">
          <button onClick={() => setOpen(true)} aria-label="Open menu" title="Open menu" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] lg:hidden">
            <IconMenu2 className="h-4 w-4" aria-hidden />
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{topbar}</div>
        </header>
        <main className="min-w-0 flex-1 px-4 pb-12 sm:px-8">{/* A block of auto height: a panel that fills its grid cell must not stretch over the page when it stands alone. */}<div>{children}</div></main>
      </div>
    </div>
  );
}

/** A thin strip across the top of the content (support session, read-only, trial). */
export function ShellBanner({ tone = "info", children }: { tone?: "info" | "warning" | "danger"; children: ReactNode }) {
  const c = { info: "bg-[var(--ds-color-primary-500)]/15 text-[var(--ds-color-primary-200)]", warning: "bg-[var(--ds-color-warning-500)]/15 text-[var(--ds-color-warning-300)]", danger: "bg-[var(--ds-color-danger-500)]/15 text-[var(--ds-color-danger-300)]" }[tone];
  return <div role="status" className={cn("px-4 py-2 text-center text-sm sm:px-8", c)}>{children}</div>;
}
