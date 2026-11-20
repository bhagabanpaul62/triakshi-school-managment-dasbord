import type { ReactNode } from "react";
import Link from "next/link";
import { BigStat } from "@smw/ui/kit/BigStat";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { ArrowButton } from "@smw/ui/kit/Panel";
import { SegmentedGauge } from "@smw/ui/kit/SegmentedGauge";
import { TickBar } from "@smw/ui/kit/TickBar";
import { EntityList, ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { paise, relative, shortDate } from "@smw/ui/format";
import type { Announcement } from "@smw/feature-announcements/service";
import type { SchoolEvent } from "@smw/feature-events/service";
import type { DueRow } from "@smw/feature-fees/service";
import { attendanceTone, clock12 } from "../rules";
import type { AssignmentsDue, AttendanceMonth, LatestResult, TodayTimetable } from "../home-service";

const LINK = "text-sm text-[var(--ds-color-primary-300)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

/** A quiet text link under an empty state: the "what do I do next" of that panel. */
export function NextStep({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className={`mx-auto mb-2 ${LINK}`}>{children}</Link>;
}

/** The round arrow in a panel's corner that leads to the full page. */
export const open = (href: string, label: string) => <ArrowButton href={href} label={label} />;

// ---------- announcements and events ----------

export function AnnouncementsBody({ rows }: { rows: Announcement[] }) {
  return (
    <EntityList
      maxItems={5}
      empty={{ title: "No announcements yet.", description: "Notices from the school appear here." }}
      items={rows.map((a) => ({
        id: a.id, title: a.title, subtitle: a.body, meta: relative(a.publishedAt), href: "/app/announcements",
        badge: a.pinned ? <ToneBadge label="Pinned" tone="info" /> : undefined,
      }))}
    />
  );
}

export function EventsBody({ rows }: { rows: SchoolEvent[] }) {
  return (
    <EntityList
      maxItems={5}
      empty={{ title: "Nothing coming up.", description: "Events and holidays show here once they are on the calendar." }}
      items={rows.map((e) => ({
        id: e.id, title: e.title, subtitle: e.location ?? undefined, meta: shortDate(e.startsAt), href: "/app/events",
        badge: e.isHoliday ? <ToneBadge label="Holiday" tone="warning" /> : undefined,
      }))}
    />
  );
}

// ---------- timetable ----------

export function TimetableBody({ t, emptyHint }: { t: TodayTimetable; emptyHint: string }) {
  if (t.day === null) return <WidgetEmptyState title="No classes today." description="It is Sunday. Enjoy the day off." />;
  if (t.rows.length === 0) return <WidgetEmptyState title="Your timetable is not set yet." description={emptyHint} />;
  return (
    <ul className="flex flex-col gap-0.5">
      {t.rows.map((r) => (
        <li
          key={`${r.periodId}-${r.section ?? ""}`}
          className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${r.state === "now" ? "bg-white/[0.07]" : ""} ${r.state === "done" ? "opacity-50" : ""}`}
          aria-current={r.state === "now" ? "true" : undefined}
        >
          <span className="w-[72px] shrink-0 text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{clock12(r.startsAt)}<br />{clock12(r.endsAt)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-[var(--ds-on-surface)]">{r.subject ?? r.name}</span>
            <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{[r.section, r.teacher, r.room].filter(Boolean).join(" · ") || r.name}</span>
          </span>
          {r.state === "now" ? <ToneBadge label="Now" tone="info" /> : r.state === "next" ? <ToneBadge label="Next" /> : null}
        </li>
      ))}
    </ul>
  );
}

// ---------- attendance ----------

export function MonthGauge({ a }: { a: AttendanceMonth }) {
  if (a.pct === null) return <WidgetEmptyState title="No attendance marked this month yet." description="It appears here once the teacher marks a day." />;
  return (
    <>
      <SegmentedGauge value={a.pct} tone={attendanceTone(a.pct)} label="attendance this month" caption={`Since ${shortDate(a.from)}`} />
      <FactList className="mt-4">
        <Fact label="Present">{String(a.present)}</Fact>
        <Fact label="Late">{String(a.late)}</Fact>
        <Fact label="Absent">{String(a.absent)}</Fact>
        <Fact label="On leave">{String(a.leave)}</Fact>
      </FactList>
    </>
  );
}

// ---------- assignments, results, fees ----------

export function AssignmentsBody({ a }: { a: AssignmentsDue }) {
  return (
    <EntityList
      maxItems={6}
      empty={{ title: "Nothing is due.", description: "New homework shows up here the moment a teacher sets it." }}
      items={a.rows.map((r) => ({
        id: r.assignmentId, title: r.title, subtitle: r.subjectName, href: `/app/assignments/${r.assignmentId}`,
        badge: <ToneBadge label={r.hint} tone={r.overdue ? "danger" : "default"} />,
      }))}
    />
  );
}

export function ResultBody({ r }: { r: LatestResult | null }) {
  if (!r) return <WidgetEmptyState title="No results published yet." description="Results appear here after the school publishes an exam." />;
  return (
    <div className="flex flex-1 flex-col justify-between gap-5">
      <BigStat
        label={r.examName} size="lg" value={r.percent === null ? "-" : `${r.percent}%`} tone={r.result === "pass" ? "success" : r.result === "fail" ? "danger" : "default"}
        hint={[r.grade ? `Grade ${r.grade}` : null, r.rank ? `Rank ${r.rank} of ${r.sectionSize}` : null].filter(Boolean).join(" · ") || undefined}
      />
      <Link href={`/app/results/${r.examId}/${r.studentId}`} className={LINK}>See marks by subject</Link>
    </div>
  );
}

export function FeesBody({ row, studentId }: { row: DueRow | null; studentId: string }) {
  if (!row) return <WidgetEmptyState title="No fees to show yet." description="Fees appear here once the school sets them up for this class." />;
  const billed = row.gross - row.concession + row.late;
  const paidPct = billed > 0 ? Math.round((row.paid / billed) * 100) : 100;
  return (
    <div className="flex flex-1 flex-col justify-between gap-5">
      {row.due === 0 ? (
        <div>
          <ToneBadge label="Paid up" tone="success" />
          <p className="mt-3 text-sm text-[var(--ds-on-surface-variant)]">Nothing is due. {paise(row.paid)} has been received this year.</p>
        </div>
      ) : (
        <>
          <BigStat
            label={row.overdue > 0 ? "Overdue now" : "Due"} size="lg" value={paise(row.overdue > 0 ? row.overdue : row.due)} tone={row.overdue > 0 ? "danger" : "default"}
            hint={[row.overdue > 0 && row.due > row.overdue ? `${paise(row.due)} due in total` : null, row.nextDueDate ? `next due ${shortDate(row.nextDueDate)}` : null].filter(Boolean).join(" · ") || undefined}
          />
          <div>
            <div className="mb-2 flex justify-between text-xs text-[var(--ds-on-surface-muted)]"><span>{paise(row.paid)} paid</span><span>{paidPct}% of {paise(billed)}</span></div>
            <TickBar value={paidPct} tone={row.overdue > 0 ? "danger" : "info"} />
          </div>
        </>
      )}
      <Link href={`/app/fees/students/${studentId}`} className={LINK}>View ledger and receipts</Link>
    </div>
  );
}
