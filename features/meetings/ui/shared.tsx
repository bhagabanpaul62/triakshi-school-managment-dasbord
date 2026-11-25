import Link from "next/link";
import { IconChevronDown, IconChevronLeft } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { TONE, type Tone } from "@smw/ui/tone";
import type { MeetingState } from "../constants";

export const STATE_LABEL: Record<MeetingState, string> = { draft: "Draft", open: "Booking open", closed: "Booking closed", done: "Over", cancelled: "Cancelled" };
export const STATE_TONE: Record<MeetingState, Tone> = { draft: "default", open: "success", closed: "warning", done: "default", cancelled: "danger" };

const BUTTON = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
/** A link that looks like a button: filled for the one main step, quiet for the rest. */
export function LinkButton({ href, children, primary = false, download = false }: { href: string; children: ReactNode; primary?: boolean; download?: boolean }) {
  const cls = `${BUTTON} ${primary ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.07] text-[var(--ds-on-surface)] hover:bg-white/[0.12]"}`;
  return download || href.startsWith("/api/") ? <a href={href} className={cls} {...(download ? { download: true } : { target: "_blank", rel: "noreferrer" })}>{children}</a> : <Link href={href} className={cls}>{children}</Link>;
}

/** The quiet actions of a page header, folded behind one button so the header has a single main step. */
export function MoreMenu({ children }: { children: ReactNode }) {
  return (
    <details className="relative">
      <summary className={`${BUTTON} cursor-pointer list-none bg-white/[0.07] text-[var(--ds-on-surface)] hover:bg-white/[0.12] [&::-webkit-details-marker]:hidden`}>More<IconChevronDown className="h-4 w-4" aria-hidden /></summary>
      <div className="absolute right-0 z-20 mt-2 flex min-w-56 flex-col items-stretch gap-1 rounded-2xl bg-[var(--ds-surface-container-high)] p-1.5 shadow-lg [&_a]:justify-start [&_button]:justify-start">{children}</div>
    </details>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]"><IconChevronLeft className="h-4 w-4" aria-hidden />{children}</Link>;
}

/** One line saying what is missing, with the step that fixes it, or who to ask. */
export function Notice({ children, tone = "default" }: { children: ReactNode; tone?: Tone }) {
  return <p role={tone === "default" ? undefined : "status"} className={`rounded-2xl bg-white/[0.05] px-4 py-3 text-sm ${TONE[tone].text}`}>{children}</p>;
}

/** A plain link into the requests module (no import): a staff follow-up about one child after a meeting. Nothing when requests is off. */
export function FollowUp({ show, studentId, meetingId, title }: { show: boolean; studentId: string; meetingId: string; title: string }) {
  if (!show) return null;
  const q = new URLSearchParams({ student: studentId, about: `Meeting: ${title}`, href: `/app/meetings/${meetingId}` });
  return <Link href={`/app/requests/new?${q}`} className="text-sm underline">Follow up</Link>;
}
