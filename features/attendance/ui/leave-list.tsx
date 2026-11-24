import Link from "next/link";
import type { ReactNode } from "react";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { shortDate } from "@smw/ui/format";
import type { LeaveRow } from "../leave-service";

const TONE = { pending: "warning", approved: "success", rejected: "danger", cancelled: "info" } as const;
const days = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} to ${shortDate(b)}`);

/** Leave requests as a list: who, dates, reason, supporting file, status; `actions` renders per-row buttons. */
export function LeaveList({ rows, empty, actions, highlight }: { rows: LeaveRow[]; empty: { title: string; description: string; action?: ReactNode }; actions?: (r: LeaveRow) => ReactNode; highlight?: string }) {
  if (rows.length === 0) return <Panel><WidgetEmptyState title={empty.title} description={empty.description} />{empty.action ? <div className="flex justify-center pb-6">{empty.action}</div> : null}</Panel>;
  return (
    <Panel>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.id} id={r.id} className={`flex flex-wrap items-start justify-between gap-3 rounded-2xl px-3 py-3 hover:bg-white/[0.03] ${r.id === highlight ? "bg-white/[0.06]" : ""}`}>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--ds-on-surface)]">
                {r.who}
                {r.section ? <span className="text-xs text-[var(--ds-on-surface-muted)]">{r.section}</span> : r.kind === "staff" ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Staff</span> : null}
                {r.typeName ? <span className="text-xs text-[var(--ds-on-surface-muted)]">{r.typeName}{r.halfDay ? `, ${r.halfDay} half` : ""}</span> : null}
                <ToneBadge label={r.status[0]!.toUpperCase() + r.status.slice(1)} tone={TONE[r.status]} />
              </p>
              <p className="mt-1 text-sm text-[var(--ds-on-surface-variant)]">{days(r.fromDate, r.toDate)}</p>
              <p className="mt-1 break-words text-sm text-[var(--ds-on-surface-muted)]">{r.reason}</p>
              {r.waitingFor ? <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">Waiting for {r.waitingFor} to decide.</p> : null}
              {r.note ? <p className="mt-1 break-words text-xs text-[var(--ds-on-surface-muted)]">{r.status === "rejected" ? "Why not: " : "Note: "}{r.note}</p> : null}
              {r.fileUrl ? <Link href={r.fileUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[var(--ds-primary)] underline">{r.fileName ?? "Attachment"}</Link> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions(r)}</div> : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
