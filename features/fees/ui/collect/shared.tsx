import type { ReactNode } from "react";
import Link from "next/link";
import { allows, type Ctx } from "@smw/feature-kit";
import { buttonVariants } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import feesFeature from "../../feature";

export type Search = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const can = (ctx: Ctx, perm: keyof typeof feesFeature.permissions) => allows(ctx, feesFeature, perm);
/** A `next` link is followed only when it stays inside the app. */
export const safeNext = (v: string | undefined) => (v && /^\/app(\/|$)/.test(v) && !v.includes("//") ? v : undefined);
export const withNext = (href: string, next: string) => `${href}${href.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;

const SECTIONS = [
  { href: "/app/fees/collect", label: "Collect", perm: "collect" }, { href: "/app/fees/receipts", label: "Receipts", perm: "read" }, { href: "/app/fees/cheques", label: "Cheques", perm: "collect" },
  { href: "/app/fees/slips", label: "UPI slips", perm: "collect" }, { href: "/app/fees/counter", label: "Cash counter", perm: "collect" }, { href: "/app/fees/refunds", label: "Refunds", perm: "read" },
] as const;

/** The way between the money-taking screens: only the ones this person may open. */
export function DeskNav({ ctx, current }: { ctx: Ctx; current: string }) {
  return (
    <nav aria-label="Taking money" className="-mt-4 mb-6 flex gap-1 overflow-x-auto pb-1">
      {SECTIONS.filter((s) => can(ctx, s.perm)).map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? "page" : undefined}
          className={cn("shrink-0 rounded-full px-4 py-2 text-sm transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]", s.href === current ? "bg-white/[0.1] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)]")}>{s.label}</Link>
      ))}
    </nav>
  );
}

/** One line that says what is missing or what went wrong, with the link that fixes it. */
export function Notice({ tone = "warning", children, action }: { tone?: "warning" | "danger" | "info"; children: ReactNode; action?: ReactNode }) {
  const color = { warning: "var(--ds-color-warning-400)", danger: "var(--ds-color-danger-400)", info: "var(--ds-on-surface-variant)" }[tone];
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm">
      <p style={{ color }} className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

export const NoticeLink = ({ href, children }: { href: string; children: ReactNode }) => <Link href={href} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>{children}</Link>;

/** Shown in place of a page the person may not open: a plain sentence and a way on, never a raw 403. */
export function NoAccess({ what, who, home = "/app" }: { what: string; who: string; home?: string }) {
  return (
    <div className="rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
      <h1 className="text-xl font-medium">{what} are for {who}</h1>
      <p className="mt-2 text-sm text-[var(--ds-on-surface-muted)]">Ask an admin if you need access.</p>
      <Link href={home} className={buttonVariants({ variant: "secondary", className: "mt-4 rounded-full" })}>Go home</Link>
    </div>
  );
}

export const BackLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="mb-3 inline-flex min-h-10 items-center text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">‹ {children}</Link>
);

/** A bill or student id shown as a link, never bare. */
export const Ref = ({ href, children }: { href: string; children: ReactNode }) => <Link href={href} className="underline underline-offset-4 hover:text-[var(--ds-primary)]">{children}</Link>;

export const SECTION = "rounded-3xl bg-[var(--ds-surface-container-low)] p-5";
export const H2 = "mb-3 text-sm font-medium text-[var(--ds-on-surface-variant)]";
/** `YYYY-MM-DD` or a timestamp as "10 Nov 2026" (server and browser agree: fixed zone). */
export const day = (d: string | Date) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
