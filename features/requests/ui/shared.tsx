import type { ReactNode } from "react";
import Link from "next/link";
import { allows, type Ctx } from "@smw/feature-kit";
import { buttonVariants } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { ageWords } from "../clock";
import type { RequestState } from "../constants";
import requestsFeature from "../feature";

export type Search = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const can = (ctx: Ctx, perm: keyof typeof requestsFeature.permissions) => allows(ctx, requestsFeature, perm);
/** The office, or a teacher (for their own students), may write a request down for a family. */
export const canWriteFor = (ctx: Ctx) => can(ctx, "office") || ctx.role === "teacher";
export const isFamilyRole = (ctx: Ctx) => ctx.role === "student" || ctx.role === "parent";

/** The way between the request screens: only the ones this person may open. The "New request" and "Ask the school" buttons are on the page itself, so they are not tabs. */
export function SectionNav({ ctx, current }: { ctx: Ctx; current: string }) {
  const family = isFamilyRole(ctx);
  const items = [
    { href: "/app/requests", label: family ? "My requests" : "Queue", show: true },
    { href: "/app/requests/report", label: "Report", show: can(ctx, "manage") },
    { href: "/app/requests/settings", label: "Categories", show: can(ctx, "manage") },
  ].filter((i) => i.show);
  if (items.length < 2) return null;
  return (
    <nav aria-label="Requests" className="-mt-4 mb-6 flex gap-1 overflow-x-auto pb-1">
      {items.map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? "page" : undefined}
          className={cn("shrink-0 rounded-full px-4 py-2 text-sm transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]", s.href === current ? "bg-white/[0.1] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)]")}>{s.label}</Link>
      ))}
    </nav>
  );
}

/** One line that says what is missing or what went wrong, with the link that fixes it. */
export function Notice({ tone = "info", children, action }: { tone?: "warning" | "danger" | "info"; children: ReactNode; action?: { href: string; label: string } }) {
  const color = { warning: "var(--ds-color-warning-400)", danger: "var(--ds-color-danger-400)", info: "var(--ds-on-surface-variant)" }[tone];
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-sm">
      <p style={{ color }} className="min-w-0 flex-1">{children}</p>
      {action ? <Link href={action.href} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>{action.label}</Link> : null}
    </div>
  );
}

/** In place of a page the person may not open: a plain sentence and a way on, never a raw 403. */
export function NoAccess({ what, who }: { what: string; who: string }) {
  return (
    <div className="rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
      <h1 className="text-xl font-medium">{what} is for {who}</h1>
      <p className="mt-2 text-sm text-[var(--ds-on-surface-muted)]">Ask your admin if you need access.</p>
      <div className="mt-4"><Link href="/app" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Go home</Link></div>
    </div>
  );
}

export const BackLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="mb-3 inline-flex min-h-10 items-center text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">‹ {children}</Link>
);

/** "Due 5 Nov", "2 days late", or "Waiting for the family". */
export function dueWords(r: { dueAt: Date; paused: boolean; overdue: boolean; state: RequestState }): string {
  if (r.state === "resolved" || r.state === "closed") return "";
  if (r.paused) return "Waiting for the family";
  const days = Math.round((r.dueAt.getTime() - Date.now()) / 86_400_000);
  if (r.overdue) return `${Math.max(1, -days)} ${Math.max(1, -days) === 1 ? "day" : "days"} late`;
  return days <= 0 ? "Due today" : `Due in ${days} ${days === 1 ? "day" : "days"}`;
}

/** The queue's last column: when it is due and how long it has existed, "2 days late, 5 days old". */
export const dueWithAge = (r: Parameters<typeof dueWords>[0] & { ageDays: number }) => [dueWords(r), r.ageDays < 1 ? "opened today" : `${ageWords(r.ageDays)} old`].filter(Boolean).join(", ");
