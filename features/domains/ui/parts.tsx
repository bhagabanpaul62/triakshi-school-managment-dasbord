import type { ReactNode } from "react";
import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { dateTime, shortDate } from "@smw/ui/format";
import { domainState } from "../state";
import type { SchoolDomain } from "../monitor";

export const StateChip = ({ d }: { d: SchoolDomain }) => { const s = domainState(d); return <ToneBadge label={s.label} tone={s.tone} />; };

/** The certificate line of a domain: expiry date, or why there is none. */
export function certText(d: Pick<SchoolDomain, "status" | "certExpiresAt" | "records">): string | null {
  if (d.status !== "verified") return null;
  if (d.certExpiresAt) return `Certificate until ${shortDate(d.certExpiresAt)}`;
  return d.records.some((r) => r.key === "https" && !r.ok) ? "Certificate not issued yet" : null;
}

export { dateTime };

export function Crumb({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex min-h-10 items-center gap-1 pb-2 text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">← {children}</Link>;
}

export const Note = ({ title, children }: { title: string; children: ReactNode }) => <Panel title={title}><div className="text-sm text-[var(--ds-on-surface-variant)]">{children}</div></Panel>;
