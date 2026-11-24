import type { ReactNode } from "react";
import Link from "next/link";
import { allows, type Ctx } from "@smw/feature-kit";
import { buttonVariants } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import expensesFeature from "../feature";

export type Search = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** A `next` link is followed only when it stays inside the app. */
export const safeNext = (v: string | undefined) => (v && /^\/app(\/|$)/.test(v) && !v.includes("//") ? v : undefined);
export const withNext = (href: string, next: string) => `${href}${href.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;

const SECTIONS = [
  { href: "/app/expenses", label: "Overview", perm: "read" }, { href: "/app/expenses/bills", label: "Bills", perm: "read" }, { href: "/app/expenses/payments", label: "Payments", perm: "read" },
  { href: "/app/expenses/vendors", label: "Vendors", perm: "read" }, { href: "/app/expenses/petty", label: "Petty cash", perm: "claim" }, { href: "/app/expenses/claims", label: "Claims", perm: "claim" },
  { href: "/app/expenses/budgets", label: "Budgets", perm: "read" }, { href: "/app/expenses/recurring", label: "Recurring", perm: "read" }, { href: "/app/expenses/income", label: "Other income", perm: "read" },
] as const;

/** The way between the expenses screens: only the ones this person may open. */
export function SectionNav({ ctx, current }: { ctx: Ctx; current: string }) {
  return (
    <nav aria-label="Expenses" className="-mt-4 mb-6 flex gap-1 overflow-x-auto pb-1">
      {SECTIONS.filter((s) => allows(ctx, expensesFeature, s.perm)).map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? "page" : undefined}
          className={cn("shrink-0 rounded-full px-4 py-2 text-sm transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]", s.href === current ? "bg-white/[0.1] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)]")}>{s.label}</Link>
      ))}
    </nav>
  );
}

/** One line that says what is missing or what went wrong, with the link that fixes it. */
export function Notice({ tone = "warning", children, action }: { tone?: "warning" | "danger" | "info"; children: ReactNode; action?: { href: string; label: string } }) {
  const color = { warning: "var(--ds-color-warning-400)", danger: "var(--ds-color-danger-400)", info: "var(--ds-on-surface-variant)" }[tone];
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm">
      <p style={{ color }} className="min-w-0 flex-1">{children}</p>
      {action ? <Link href={action.href} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>{action.label}</Link> : null}
    </div>
  );
}

/** Shown in place of a page the person may not open: a plain sentence and a way on, never a raw 403. */
export function NoAccess({ ctx, what, who }: { ctx: Ctx; what: string; who: string }) {
  const claims = allows(ctx, expensesFeature, "claim");
  return (
    <div className="rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
      <h1 className="text-xl font-medium">{what} are for {who}</h1>
      <p className="mt-2 text-sm text-[var(--ds-on-surface-muted)]">{claims ? "You can still ask for money back for something you paid for." : "Ask an admin if you need access."}</p>
      <div className="mt-4 flex gap-2">
        {claims ? <Link href="/app/expenses/claims" className={buttonVariants({ className: "rounded-full" })}>My claims</Link> : null}
        <Link href="/app" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Go home</Link>
      </div>
    </div>
  );
}
export const can = (ctx: Ctx, perm: keyof typeof expensesFeature.permissions) => allows(ctx, expensesFeature, perm);
export const BackLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="mb-3 inline-flex min-h-10 items-center text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">‹ {children}</Link>
);
export const journalHref = (id: string | null | undefined) => (id ? `/app/finance/journals/${id}` : null);
export function JournalLink({ id, label = "Ledger entry" }: { id: string | null | undefined; label?: string }) {
  return id ? <Link href={`/app/finance/journals/${id}`} className="text-sm underline underline-offset-4">{label}</Link> : <span className="text-sm text-[var(--ds-on-surface-muted)]">Not posted yet</span>;
}
