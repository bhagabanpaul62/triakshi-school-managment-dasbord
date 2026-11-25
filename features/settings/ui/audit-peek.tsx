"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { SidePeek } from "@smw/ui/finance/SidePeek";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { dateTime } from "@smw/ui/format";
import type { AuditDetail } from "../audit-service";
import { moduleLabel } from "./labels";

const stamp = (d: Date) => `${new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}, ${new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" })}`;
const verb = (a: string) => a.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());

/** One audit entry beside the list: who, when, from where, what changed field by field, the record, and the entries about the same record. */
export function AuditPeek({ detail }: { detail: AuditDetail }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    return `${path}${next.size ? `?${next}` : ""}`;
  };
  const closeHref = href({ entry: null });
  const entryHref = (id: string) => href({ entry: id });
  const recordHref = detail.entityId ? href({ record: detail.entityId, entry: null, page: null }) : null;
  return (
    <SidePeek open onOpenChange={(o) => { if (!o) router.replace(closeHref, { scroll: false }); }} size="lg"
      title={detail.summary ?? `${verb(detail.action)} ${detail.entity?.toLowerCase() ?? ""}`.trim()} description={stamp(detail.createdAt)}
      headerTrailing={<ToneBadge label={moduleLabel(detail.module)} />}>
      <div className="flex flex-col gap-6 pt-2">
        <FactList>
          <Fact label="Who" wrap>{detail.actor}{detail.support ? " · Triakshi support" : ""}</Fact>
          <Fact label="What">{verb(detail.action)}{detail.entity ? ` · ${detail.entity}` : ""}</Fact>
          <Fact label="When" wrap>{stamp(detail.createdAt)}</Fact>
          <Fact label="Where from" copy={detail.ip ?? undefined}>{detail.ip}</Fact>
        </FactList>

        <section aria-labelledby="peek-changes">
          <h4 id="peek-changes" className="mb-2 text-sm font-medium text-[var(--ds-on-surface)]">What changed</h4>
          {detail.changes.length ? (
            <div className="relative overflow-x-auto rounded-2xl bg-white/[0.035]">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="text-xs text-[var(--ds-on-surface-muted)]"><tr><th className="px-4 py-2 font-normal">Field</th><th className="px-4 py-2 font-normal">Before</th><th className="px-4 py-2 font-normal">After</th></tr></thead>
                <tbody>
                  {detail.changes.map((c) => (
                    <tr key={c.field} className="border-t border-white/[0.05] align-top">
                      <th scope="row" className="px-4 py-2 font-normal text-[var(--ds-on-surface-variant)]">{c.field}</th>
                      <td className="break-words px-4 py-2 text-[var(--ds-on-surface-muted)]">{c.from}</td>
                      <td className="break-words px-4 py-2 text-[var(--ds-on-surface)]">{c.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-2xl bg-white/[0.035] p-4 text-sm text-[var(--ds-on-surface-muted)]">This entry did not record field values. Passwords, medical notes, pay and other private text are never stored in the log.</p>
          )}
          {detail.changes.some((c) => c.from === "(hidden)") ? <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">Fields shown as (hidden) changed, but their words are never kept in the log.</p> : null}
        </section>

        {detail.entity ? (
          <section aria-labelledby="peek-record" className="flex flex-col gap-2">
            <h4 id="peek-record" className="text-sm font-medium text-[var(--ds-on-surface)]">The record</h4>
            <div className="flex flex-wrap items-center gap-2">
              {detail.link ? <Link href={detail.link.href} className={PILL_BTN}>Open {detail.link.label.toLowerCase()}</Link>
                : <span className="text-sm text-[var(--ds-on-surface-muted)]">{detail.entityId ? "This record no longer exists. The entry keeps what happened." : "This entry is not about one record."}</span>}
              {recordHref ? <Link href={recordHref} replace scroll={false} className={PILL_BTN}>All entries for this record</Link> : null}
            </div>
          </section>
        ) : null}

        {detail.related.length ? (
          <section aria-labelledby="peek-related">
            <h4 id="peek-related" className="mb-2 text-sm font-medium text-[var(--ds-on-surface)]">Other entries about it</h4>
            <ul className="flex flex-col">
              {detail.related.map((r) => (
                <li key={r.id}>
                  <Link href={entryHref(r.id)} replace scroll={false} className="flex min-h-10 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-white/[0.05]">
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--ds-on-surface)]">{r.summary ?? verb(r.action)}</span>
                    <span className="shrink-0 text-xs text-[var(--ds-on-surface-muted)]">{r.actor.split(" (")[0]} · {dateTime(r.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </SidePeek>
  );
}
