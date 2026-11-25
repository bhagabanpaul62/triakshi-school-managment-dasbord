import Link from "next/link";
import { IconChevronLeft } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { dateTime } from "@smw/ui/format";
import { commState } from "@smw/ui/comm/states";
import { TONE, type Tone } from "@smw/ui/tone";
import { NOTICE_STATES, type NoticeState } from "../constants";

export { TYPE_LABEL } from "../constants";
/** The notice states as the shared state map names them (a notice "waiting" is "pending_approval" there). */
export const STATE_KEY: Record<NoticeState, string> = { draft: "draft", waiting: "pending_approval", scheduled: "scheduled", sending: "sending", published: "published", expired: "expired", withdrawn: "withdrawn" };
export const STATE_LABEL = Object.fromEntries(NOTICE_STATES.map((s) => [s, s === "sending" ? "Sending" : commState("notice", STATE_KEY[s]).label])) as Record<NoticeState, string>;
export const STATE_TONE = Object.fromEntries(NOTICE_STATES.map((s) => [s, s === "sending" ? "info" : commState("notice", STATE_KEY[s]).tone])) as Record<NoticeState, Tone>;

const BUTTON = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
/** A link that looks like a button: filled for the one main step, quiet for the rest. Files and API routes open in a new tab. */
export function LinkButton({ href, children, primary = false, download = false }: { href: string; children: ReactNode; primary?: boolean; download?: boolean }) {
  const cls = `${BUTTON} ${primary ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.07] text-[var(--ds-on-surface)] hover:bg-white/[0.12]"}`;
  return download || href.startsWith("/api/") ? <a href={href} className={cls} {...(download ? { download: true } : { target: "_blank", rel: "noreferrer" })}>{children}</a> : <Link href={href} className={cls}>{children}</Link>;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]"><IconChevronLeft className="h-4 w-4" aria-hidden />{children}</Link>;
}

/** One line saying what is missing, with the step that fixes it, or who to ask. */
export function Notice({ children, tone = "default" }: { children: ReactNode; tone?: Tone }) {
  return <p role={tone === "default" ? undefined : "status"} className={`rounded-2xl bg-white/[0.05] px-4 py-3 text-sm ${TONE[tone].text}`}>{children}</p>;
}

export type Query = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export const HOME = "/app/announcements";

/** A thing in another module that points at this notice, as a link line. */
export interface Related { title: string; href: string; startsAt: Date; cancelled: boolean }
export function RelatedLinks({ related }: { related: Related[] }) {
  if (!related.length) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {related.map((r) => <li key={r.href}>This is the consent for <Link href={r.href} className="underline underline-offset-4">{r.title}</Link>, {dateTime(r.startsAt)}{r.cancelled ? " (cancelled)" : ""}.</li>)}
    </ul>
  );
}
