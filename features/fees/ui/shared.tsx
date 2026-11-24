import type { ReactNode } from "react";
import Link from "next/link";
import { allows, type Ctx } from "@smw/feature-kit";
import { buttonVariants } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import feesFeature from "../feature";

export type Search = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export { safeNext, withNext } from "./logic";
export const can = (ctx: Ctx, perm: keyof typeof feesFeature.permissions) => allows(ctx, feesFeature, perm);

const SECTIONS = [
  { href: "/app/fees", label: "Overview", perm: "read" }, { href: "/app/fees/invoices", label: "Bills", perm: "read" }, { href: "/app/fees/dues", label: "Dues", perm: "read" },
  { href: "/app/fees/collect", label: "Collect", perm: "collect" }, { href: "/app/fees/receipts", label: "Receipts", perm: "read" }, { href: "/app/fees/plans", label: "Fee plans", perm: "setup" },
  { href: "/app/fees/heads", label: "Fee heads", perm: "setup" }, { href: "/app/fees/concessions", label: "Concessions", perm: "concede" }, { href: "/app/fees/reports", label: "Reports", perm: "read" },
] as const;

/** The way between the fee screens: only the ones this person may open. */
export function SectionNav({ ctx, current }: { ctx: Ctx; current: string }) {
  return (
    <nav aria-label="Fees" className="-mt-4 mb-6 flex gap-1 overflow-x-auto pb-1">
      {SECTIONS.filter((s) => can(ctx, s.perm)).map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? "page" : undefined}
          className={cn("shrink-0 rounded-full px-4 py-2 text-sm transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]", s.href === current ? "bg-white/[0.1] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)]")}>{s.label}</Link>
      ))}
    </nav>
  );
}

/** One line that says what is missing or what went wrong, with the link that fixes it. */
export function Notice({ tone = "warning", children, action, who }: { tone?: "warning" | "danger" | "info"; children: ReactNode; action?: { href: string; label: string }; /** Who can fix it when this person cannot: names them instead of a button. */ who?: string }) {
  const color = { warning: "var(--ds-color-warning-400)", danger: "var(--ds-color-danger-400)", info: "var(--ds-on-surface-variant)" }[tone];
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm">
      <p style={{ color }} className="min-w-0 flex-1">{children}{who && !action ? ` Ask ${who}.` : ""}</p>
      {action ? <Link href={action.href} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>{action.label}</Link> : null}
    </div>
  );
}

/** Shown in place of a page the person may not open: a plain sentence and a way on, never a raw 403. */
export function NoAccess({ what, who, home = "/app" }: { what: string; who: string; home?: string }) {
  return (
    <div className="rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
      <h1 className="text-xl font-medium">{what} are for {who}</h1>
      <p className="mt-2 text-sm text-[var(--ds-on-surface-muted)]">Ask an admin if you need access.</p>
      <div className="mt-4"><Link href={home} className={buttonVariants({ className: "rounded-full" })}>Go home</Link></div>
    </div>
  );
}

export const BackLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="mb-3 inline-flex min-h-10 items-center text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">‹ {children}</Link>
);

export function JournalLink({ id, label = "Ledger entry" }: { id: string | null | undefined; label?: string }) {
  return id ? <Link href={`/app/finance/journals/${id}`} className="text-sm underline underline-offset-4">{label}</Link> : null;
}

/** A small button-looking link. */
export const PillLink = ({ href, children, primary, prefetch }: { href: string; children: ReactNode; primary?: boolean; prefetch?: boolean }) => (
  <Link href={href} prefetch={prefetch} className={buttonVariants({ variant: primary ? "default" : "secondary", className: "rounded-full" })}>{children}</Link>
);

/** The query string of a page without the keys that must not carry over (a peek, the page number). */
export const queryOf = (sp: Record<string, string | string[] | undefined>, drop: string[] = ["page"]) =>
  new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v && !drop.includes(k) ? [[k, v]] : []))).toString();

export const STATE_TABS = [["", "All"], ["draft", "Drafts"], ["open", "Open"], ["overdue", "Overdue"], ["paid", "Paid"], ["cancelled", "Cancelled"]] as const;

export function Tabs({ tabs, current, href, label }: { tabs: readonly (readonly [string, string, number?])[]; current: string; href: (v: string) => string; label: string }) {
  return (
    <nav aria-label={label} className="mb-4 flex gap-1 overflow-x-auto">
      {tabs.map(([v, text, n]) => (
        <Link key={v} href={href(v)} aria-current={current === v ? "page" : undefined}
          className={cn("shrink-0 rounded-full px-4 py-2 text-sm hover:bg-white/[0.06]", current === v ? "bg-white/[0.1]" : "text-[var(--ds-on-surface-muted)]")}>
          {text}{n !== undefined ? <span className="ml-2 tabular-nums text-[var(--ds-on-surface-muted)]">{n}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** Date range as a plain GET form that keeps every other filter in the address. */
export function DateRange({ sp, names = ["from", "to"], labels = ["Due from", "to"] }: { sp: Record<string, string | string[] | undefined>; names?: [string, string] | string[]; labels?: string[] }) {
  const keep = Object.entries(sp).filter(([k, v]) => typeof v === "string" && v && !names.includes(k) && k !== "page");
  const cls = "h-10 rounded-full bg-white/[0.05] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
  return (
    <form method="get" className="flex flex-wrap items-center gap-2 text-sm text-[var(--ds-on-surface-muted)]">
      {keep.map(([k, v]) => <input key={k} type="hidden" name={k} value={v as string} />)}
      <label className="flex items-center gap-2">{labels[0]}<input type="date" name={names[0]} defaultValue={(sp[names[0]!] as string) ?? ""} className={cls} /></label>
      <label className="flex items-center gap-2">{labels[1]}<input type="date" name={names[1]} defaultValue={(sp[names[1]!] as string) ?? ""} className={cls} /></label>
      <button type="submit" className="h-10 rounded-full bg-white/[0.07] px-4 font-medium text-[var(--ds-on-surface)] hover:bg-white/[0.12]">Apply</button>
    </form>
  );
}
