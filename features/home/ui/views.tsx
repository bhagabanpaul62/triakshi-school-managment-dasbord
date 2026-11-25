import type { ReactNode } from "react";
import Link from "next/link";
import { HatchedBars } from "@smw/ui/kit/HatchedBars";
import { DeltaChip } from "@smw/ui/kit/DeltaChip";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { SummaryRows } from "@smw/ui/kit/SummaryRows";
import { TickBar } from "@smw/ui/kit/TickBar";
import { EntityList, ProgressList, ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { ROW_HOVER } from "@smw/ui/tone";
import { formatMoneyCompact } from "@smw/ui/money";
import { initials, paise, shortDate, tilePaise as tile } from "@smw/ui/format";
import { METHOD_LABEL } from "@smw/feature-fees/service";
import { GettingStartedCard } from "@smw/feature-setup/ui/getting-started-card";
import type { PanelData } from "../home-service";
import type { PanelKey } from "../panels";
import { plural, planTone, receiptsHref, type Change } from "../rules";
import { FeeTrend } from "./fee-trend";
import { Line } from "./line";
import { WeekTrend } from "./week-trend";
import { AnnouncementsBody, EventsBody, FeesBody, MeetingsTodayBody, MonthGauge, NeedsActionBody, RequestsBody, ResultBody, TimetableBody, AssignmentsBody, dayOffWords, open } from "./parts";

const LINK = "text-sm text-[var(--ds-color-primary-300)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
const ICON = { attendance: "check", fees: "money", marks: "exam", support: "support", enquiries: "inbox" } as const;
const CALL = "inline-flex min-h-9 items-center rounded-full bg-white/[0.06] px-3 text-xs text-[var(--ds-on-surface)] hover:bg-white/[0.12]";
const avatar = (name: string) => <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-xs" aria-hidden>{initials(name)}</span>;
const time = (d: Date) => new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const chip = (c: Change | null) => c ? <DeltaChip direction={c.direction} tone={c.tone}>{c.text}</DeltaChip> : undefined;
const STAGE_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", visit: "Visit booked", visited: "Visited", applied: "Applied", offered: "Offered", waitlist: "Waitlist", admitted: "Admitted" };

type V = { [K in PanelKey]: (d: PanelData[K]) => ReactNode };

/** A list that is its own panel, or one line when there is nothing in it. */
function Listed({ title, href, label, quiet, children, empty }: { title: string; href: string; label: string; quiet: string; empty: boolean; children: ReactNode }) {
  return empty ? <Line title={title} href={href}>{quiet}</Line> : <Panel title={title} action={open(href, label)}>{children}</Panel>;
}

export const VIEWS: V = {
  // ---------- everyone ----------
  "today": (t) => (
    <Panel>
      <ul className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
        <li>{t.dayOff
          ? <><ToneBadge label={`Day off: ${t.dayOff.name}`} tone="warning" /> <span className="ml-2 text-[var(--ds-on-surface-variant)]">{t.dayOff.next ? `Next school day: ${t.dayOff.next}` : "No school day in the next three weeks"}</span></>
          : <><ToneBadge label="School day" tone="success" /></>}</li>
        {t.closures[0] ? <li><Link href="/app/attendance/holidays" className={LINK}>Closed: {t.closures[0].name}, {t.closures[0].label}</Link></li> : null}
        {t.nextEvent ? <li><Link href={`/app/events/${t.nextEvent.id}`} className={LINK}>Next event: {t.nextEvent.title}, {shortDate(t.nextEvent.startsAt)}</Link></li> : null}
        {t.staffAway !== null ? <li><Link href="/app/attendance/leave-calendar" className={LINK}>{t.staffAway ? `${plural(t.staffAway, "staff member")} away today` : "Nobody is away today"}</Link></li> : null}
      </ul>
    </Panel>
  ),
  "needs-action": (rows) => <Listed title="Needs action" href="/app/notifications?tab=action" label="All that needs action" quiet="Nothing is waiting on you." empty={rows.length === 0}><NeedsActionBody rows={rows} /></Listed>,
  "notices": (rows) => <Listed title="Notices" href="/app/announcements" label="All announcements" quiet="No announcements yet." empty={rows.length === 0}><AnnouncementsBody rows={rows} /></Listed>,
  "events": (rows) => <Listed title="Events" href="/app/events" label="Open events" quiet="Nothing coming up." empty={rows.length === 0}><EventsBody rows={rows} /></Listed>,
  "requests": (r) => !r.mine && !r.unassigned && !r.overdue ? <Line title="Requests" href="/app/requests">None waiting.</Line> : <Panel title="Requests" action={open("/app/requests", "Open requests")}><RequestsBody r={r} /></Panel>,
  "my-setup": (rows) => rows.length === 0 ? null : (
    <Panel title="Your setup tasks" action={open("/app/getting-started", "Open getting started")}>
      <EntityList maxItems={3} empty={{ title: "", description: "" }} items={rows.map((t) => ({ id: t.key, title: t.label, subtitle: t.assignedBy ? `Given to you by ${t.assignedBy}. ${t.why}` : t.why, meta: `${t.minutes} min`, href: t.href }))} />
    </Panel>
  ),
  "links": (links) => (
    <Panel title="Your pages">
      {links.length === 0 ? <WidgetEmptyState title="Nothing is open to your role yet." description="Ask the school office to give your role access to a module." /> : (
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className={`flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 text-sm ${ROW_HOVER} focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]`}>
                <MenuIconView name={l.icon} className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" />
                <span className="min-w-0 truncate">{l.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  ),

  // ---------- admin ----------
  "numbers": (cards) => cards.length === 0 ? null : (
    <KpiRow>
      {cards.map((c) => (
        <StatCard
          key={c.key} label={c.label} href={c.href} icon={<MenuIconView name={{ present: "check", collected: "money", dues: "receipt", enquiries: "inbox" }[c.key]} />}
          value={c.value === null ? "-" : c.kind === "percent" ? `${c.value}%` : c.kind === "money" ? tile(c.value) : String(c.value)} delta={chip(c.change)} meta={c.meta}
        />
      ))}
    </KpiRow>
  ),
  "attention": ({ items, unchecked }) => (
    <Panel title="Needs attention">
      {items.length === 0 ? <WidgetEmptyState title="Nothing needs you right now." description="Attendance, fees, exams and support are all up to date." />
        : <SummaryRows rows={items.map((i) => ({ key: i.key, label: i.label, value: String(i.count), tone: i.tone, href: i.href, icon: <MenuIconView name={ICON[i.key as keyof typeof ICON]} /> }))} />}
      {unchecked.length ? <p className="mt-3 text-xs text-[var(--ds-color-warning-400)]">Could not check {unchecked.join(", ")}. Refresh to try again.</p> : null}
    </Panel>
  ),
  "attendance-week": (w) => w.dayOff && !w.points.length ? <Line title="Attendance" href="/app/attendance">No classes today. {dayOffWords(w.dayOff)}</Line> : (
    <Panel title="Attendance this week" action={open("/app/attendance", "Open attendance")}>
      {w.points.length < 2
        ? <WidgetEmptyState title="Not enough days marked yet." description="The trend shows once two days of attendance are in." />
        : <WeekTrend points={w.points.map((p) => ({ label: shortDate(p.date), present: Math.round(p.pct) }))} />}
      <div className="mt-3 text-sm">
        {w.dayOff ? <p className="text-[var(--ds-on-surface-muted)]">{dayOffWords(w.dayOff)}</p>
          : w.unmarked.length === 0 ? <p className="text-[var(--ds-on-surface-muted)]">{w.sections ? "Every section is marked today." : "No sections have students yet."}</p>
          : <p className="text-[var(--ds-on-surface-variant)]">Not marked today:{" "}{w.unmarked.map((s, i) => <span key={s.id}>{i ? ", " : ""}<Link href={`/app/attendance?sectionId=${s.id}`} className={LINK}>{s.label}</Link></span>)}</p>}
      </div>
    </Panel>
  ),
  "money-trend": (m) => m.trend.every((p) => p.paise === 0) ? <Line title="Fee collection" href="/app/fees">No payments recorded yet.</Line> : (
    <Panel title="Fee collection" action={open("/app/fees/reports", "Open fee reports")}>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-[var(--ds-on-surface-variant)]">This month so far <span className="font-medium text-[var(--ds-on-surface)]">{paise(m.thisMonth)}</span>{chip(m.change)}<span className="text-xs text-[var(--ds-on-surface-muted)]">{m.lastMonthSame ? "vs the same days last month" : ""}</span></p>
      <FeeTrend points={m.trend.map((p) => ({ label: p.label, paise: p.paise }))} />
    </Panel>
  ),
  "funnel": (f) => f.total === 0 ? <Line title="Admissions" href="/app/enquiries">No enquiries yet.</Line> : (
    <Panel title="Admissions" action={open("/app/enquiries", "Open enquiries")}>
      <SummaryRows rows={f.stages.filter((s) => s.key !== "closed").map((s) => ({ key: s.key, label: STAGE_LABEL[s.key] ?? s.key, value: String(s.count), href: `/app/enquiries?view=list&stage=${s.key}` }))} />
      <p className="mt-2 px-3 text-xs text-[var(--ds-on-surface-muted)]">{plural(f.open, "enquiry", "enquiries")} still open.</p>
    </Panel>
  ),
  "my-approvals": (a) => a.rows.length === 0 ? <Line title="Waiting for approval" href="/app/fees">Nothing you asked for is waiting.</Line> : (
    <Panel title="Waiting for approval">
      <p className="mb-2 text-xs text-[var(--ds-on-surface-muted)]">What you asked for and has not been decided yet.</p>
      <EntityList maxItems={5} empty={{ title: "", description: "" }} items={a.rows.map((r) => ({ id: r.id, title: r.title, meta: r.amountPaise ? paise(r.amountPaise) : undefined, subtitle: `Asked ${shortDate(r.since)}`, href: r.href ?? undefined }))} />
    </Panel>
  ),
  "approvals": (a) => a.pending === 0 ? <Line title="Approvals" href="/app/finance/approvals">Nothing waiting for a decision.</Line> : (
    <Panel title="Approvals" action={open("/app/finance/approvals", "Open approvals")}>
      <EntityList maxItems={4} empty={{ title: "", description: "" }} items={a.rows.map((r) => ({ id: r.id, title: r.title, meta: r.amountPaise ? paise(r.amountPaise) : undefined, href: r.href }))} />
      {a.pending > a.rows.length ? <Link href="/app/finance/approvals" className={`mt-3 ${LINK}`}>See all {a.pending}</Link> : null}
    </Panel>
  ),
  "getting-started": (g) => g.card ? <GettingStartedCard {...g.card} /> : null,
  "plan": (c) => (
    <Panel title="Plan usage" action={open("/app/billing", "Open billing")}>
      <div className="flex flex-1 flex-col justify-between gap-5">
        <div>
          <p className="text-[26px] font-medium tabular-nums tracking-tight">{c.active}<span className="ml-2 text-sm font-normal text-[var(--ds-on-surface-muted)]">of {c.cap} students</span></p>
          <div className="mt-4"><TickBar label="Plan used" value={c.percent} tone={planTone(c.active, c.cap)} /></div>
          <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">{c.percent}% of your plan is in use</p>
        </div>
        {c.message ? (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-[var(--ds-on-surface-variant)]">{c.message}</p>
            <ToneBadge label={c.blocked ? "Full" : "Near limit"} tone={c.blocked ? "danger" : "warning"} />
          </div>
        ) : <p className="text-sm text-[var(--ds-on-surface-variant)]">{c.cap - c.active} places left before you reach your plan limit.</p>}
        {c.warning ? <Link href="/app/billing" className={LINK}>See plans</Link> : null}
      </div>
    </Panel>
  ),
  "leave": (l) => l.away.length === 0 && l.pending === 0 ? <Line title="Staff on leave" href="/app/attendance/leave-calendar">Nobody is on leave today.</Line> : (
    <Panel title="Staff on leave" action={open("/app/attendance/leave-calendar", "Open the leave calendar")}>
      <EntityList maxItems={5} empty={{ title: "Nobody is on leave today.", description: "" }} items={l.away.map((a) => ({ id: a.id, leading: avatar(a.name), title: a.name, meta: `Back after ${shortDate(a.until)}` }))} />
      {l.pending ? <Link href="/app/attendance/leave-requests" className={`mt-3 ${LINK}`}>{plural(l.pending, "leave request")} waiting for you</Link> : null}
    </Panel>
  ),
  "birthdays": (b) => b.students.length + b.staff.length === 0 ? <Line title="Birthdays today" href="/app/students">No birthdays today.</Line> : (
    <Panel title="Birthdays today">
      <EntityList maxItems={6} empty={{ title: "", description: "" }} items={[
        ...b.students.map((s) => ({ id: s.id, leading: avatar(s.name), title: s.name, subtitle: s.label ?? "Student", meta: s.age !== null ? `Turns ${s.age}` : undefined, href: `/app/students/${s.id}` })),
        ...b.staff.map((s) => ({ id: s.id, leading: avatar(s.name), title: s.name, subtitle: "Staff", meta: s.age !== null ? `Turns ${s.age}` : undefined, href: `/app/staff/${s.id}` })),
      ]} />
    </Panel>
  ),

  // ---------- teacher ----------
  "now-next": (t) => {
    if (t.dayOff) return <Line title="Classes" href="/app/timetable">No classes today. {dayOffWords(t.dayOff)}</Line>;
    const shown = t.rows.filter((r) => r.state === "now" || r.state === "next");
    if (t.day === null || shown.length === 0) return <Panel title="Now and next" action={open("/app/timetable", "Open timetable")}><TimetableBody t={t} emptyHint="Ask the office to set your timetable." /></Panel>;
    return (
      <Panel title="Now and next" action={open("/app/timetable", "Open timetable")}>
        <TimetableBody t={{ ...t, rows: shown }} emptyHint="" />
        <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">{plural(t.rows.filter((r) => !r.isBreak && r.state === "later").length, "more period")} after that today.</p>
      </Panel>
    );
  },
  "to-mark": (m) => m.dayOff ? <Line title="Registers" href="/app/attendance">No attendance today. {dayOffWords(m.dayOff)}</Line>
    : m.rows.length === 0 ? <Line title="Registers" href="/app/attendance">You are not a class teacher.</Line>
    : m.rows.every((r) => r.marked) ? <Line title="Registers" href="/app/attendance">All marked for today.</Line> : (
      <Panel title="Registers to mark" action={open("/app/attendance", "Open attendance")}>
        <EntityList maxItems={6} empty={{ title: "", description: "" }} items={m.rows.map((r) => ({ id: r.id, title: r.label, subtitle: plural(r.students, "student"), href: `/app/attendance?sectionId=${r.id}`, badge: r.marked ? <ToneBadge label="Marked" tone="success" /> : <ToneBadge label="Mark now" tone="warning" /> }))} />
      </Panel>
    ),
  "to-grade": (g) => (
    <Listed title="To grade" href="/app/assignments" label="Open assignments" quiet="Nothing to grade." empty={g.rows.length === 0}>
      <EntityList maxItems={5} empty={{ title: "", description: "" }} items={g.rows.map((r) => ({ id: r.id, title: r.title, subtitle: `${r.sectionLabel} · ${r.subjectName}`, meta: `Due ${shortDate(r.dueAt)}`, href: `/app/assignments/${r.id}`, badge: <ToneBadge label={`${r.toGrade} to grade`} tone="info" /> }))} />
    </Listed>
  ),
  "marks": (rows) => (
    <Listed title="Marks to enter" href="/app/exams" label="Open exams" quiet="No marks pending." empty={rows.length === 0}>
      <ProgressList maxItems={5} empty={{ title: "", description: "" }} items={rows.map((p) => ({ id: p.paperId, label: `${p.subjectName}, ${p.className}`, meta: p.examName, value: `${p.entered}/${p.students}`, progress: p.students ? (p.entered / p.students) * 100 : 0, href: `/app/exams/${p.examId}/marks/${p.paperId}` }))} />
    </Listed>
  ),
  "homework": (h) => (
    <Listed title="Homework due" href="/app/assignments" label="Open assignments" quiet="None due in the next three days." empty={h.rows.length === 0}>
      <EntityList maxItems={5} empty={{ title: "", description: "" }} items={h.rows.map((r) => ({ id: r.id, title: r.title, subtitle: `${r.sectionLabel} · ${r.subjectName}`, meta: `Due ${shortDate(r.dueAt)}`, href: `/app/assignments/${r.id}`, badge: <ToneBadge label={`${r.handedIn} handed in`} /> }))} />
    </Listed>
  ),
  "my-class": (c) => {
    if (c.dayOff) return <Line title="My class" href="/app/attendance">No classes today. {dayOffWords(c.dayOff)}</Line>;
    if (c.sections.length === 0) return <Line title="My class" href="/app/attendance">You are not a class teacher.</Line>;
    return (
      <Panel title="My class today" action={open("/app/attendance/register", "Open register")}>
        <div className="flex flex-col gap-5">
          {c.sections.map((s) => (
            <div key={s.id}>
              <p className="mb-1 flex items-center gap-2 text-sm font-medium">{s.label}{!s.marked ? <ToneBadge label="Not marked yet" tone="warning" /> : s.absent.length ? <ToneBadge label={`${s.absent.length} absent`} tone="danger" /> : <ToneBadge label="Everyone is in" tone="success" />}</p>
              {s.absent.length ? (
                <EntityList maxItems={8} empty={{ title: "", description: "" }} items={s.absent.map((a) => ({
                  id: a.id, title: a.name, href: c.canCall ? `/app/students/${a.id}` : undefined,
                  action: a.phone ? <a href={`tel:${a.phone}`} className={CALL} aria-label={`Call the family of ${a.name}`}>Call</a> : undefined,
                }))} />
              ) : null}
              {s.birthdays.length ? <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">Birthday today: {s.birthdays.map((b) => b.name).join(", ")}</p> : null}
            </div>
          ))}
        </div>
      </Panel>
    );
  },
  "meetings": (rows) => <Listed title="Parent meetings today" href="/app/meetings" label="Open meetings" quiet="No parent meetings today." empty={rows.length === 0}><MeetingsTodayBody rows={rows} /></Listed>,
  "messages": (m) => <Line title="Messages" href="/app/messages">{m.unread ? `${plural(m.unread, "unread message")}` : "No unread messages."}</Line>,

  // ---------- family ----------
  "family-answer": ({ notices, actions }) => notices.length + actions.length === 0 ? <Line title="Needs your answer" href="/app/announcements">Nothing needs your answer.</Line> : (
    <Panel title="Needs your answer" action={open("/app/notifications?tab=action", "All that needs action")}>
      <EntityList maxItems={5} empty={{ title: "", description: "" }} items={[
        ...notices.map((n) => ({ id: n.id, title: n.title, subtitle: n.excerpt, href: n.href, badge: <ToneBadge label="Answer wanted" tone="warning" /> })),
        ...actions.map((a) => ({ id: a.id, title: a.title, subtitle: a.body ?? undefined, href: a.href ?? "/app/notifications?tab=action" })),
      ]} />
    </Panel>
  ),
  "family-classes": (t) => <Panel title="Today's classes" action={open("/app/timetable", "Open timetable")}><TimetableBody t={t} emptyHint="Ask the office." /></Panel>,
  "family-homework": (a) => <Listed title="Homework due" href="/app/assignments" label="Open assignments" quiet="Nothing is due." empty={a.rows.length === 0}><AssignmentsBody a={a} /></Listed>,
  "family-dues": (f) => <Panel title="Fees" action={open(f ? `/app/fees/students/${f.id}` : "/app/fees", "Open my fees")}><FeesBody row={f} /></Panel>,
  "family-attendance": (a) => <Panel title="Attendance this month" action={open("/app/attendance", "Open attendance")}><MonthGauge a={a} /></Panel>,
  "family-exam": (e) => !e ? <Line title="Next exam" href="/app/results">No exam is scheduled.</Line> : (
    <Panel title="Next exam" action={open("/app/results", "Open results")}>
      <p className="text-[26px] font-medium tracking-tight">{e.subject}</p>
      <p className="mt-1 text-sm text-[var(--ds-on-surface-variant)]">{e.examName} · {shortDate(e.date)}{e.startTime ? `, ${e.startTime}` : ""}</p>
      {e.more ? <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">{plural(e.more, "more paper")} after this one.</p> : null}
    </Panel>
  ),
  "family-result": (r) => <Panel title="Latest result" action={open("/app/results", "Open results")}><ResultBody r={r} /></Panel>,
  "family-meeting": (m) => !m ? <Line title="Next meeting" href="/app/meetings">No meeting booked.</Line> : (
    <Panel title="Next meeting" action={open(`/app/meetings/${m.meetingId}`, "Open the meeting")}>
      <p className="text-sm font-medium">{m.teacher}</p>
      <p className="mt-1 text-sm text-[var(--ds-on-surface-variant)]">{m.title} · {shortDate(m.startsAt)}, {time(m.startsAt)}{m.place ? ` · ${m.place}` : ""}</p>
    </Panel>
  ),
  "family-bus": (b) => !b ? <Line title="Bus" href="/app/transport">No bus route yet.</Line> : (
    <Panel title="Bus" action={open("/app/transport", "Open transport")}>
      <p className="text-sm font-medium">{b.route}, {b.stop}</p>
      <FactList className="mt-3">
        {b.morning ? <Fact label="Morning pickup">{b.morning}</Fact> : null}
        {b.evening ? <Fact label="Evening drop">{b.evening}</Fact> : null}
        {b.vehicle ? <Fact label="Bus">{b.vehicle}</Fact> : null}
      </FactList>
      {b.trackingUrl ? <a href={b.trackingUrl} target="_blank" rel="noopener noreferrer" className={`mt-3 ${LINK}`}>Track the bus</a> : null}
    </Panel>
  ),
  "family-library": (l) => l.out === 0 ? <Line title="Library books" href="/app/library">No books out.</Line> : (
    <Panel title="Library books" action={open("/app/library", "Open library")}>
      <p className="text-sm">{plural(l.out, "book")} out{l.overdue ? <>, <span className="text-[var(--ds-color-danger-400)]">{l.overdue} overdue</span></> : l.dueSoon ? `, ${l.dueSoon} due soon` : ""}.</p>
      <p className="mt-1 truncate text-xs text-[var(--ds-on-surface-muted)]">{l.titles.join(", ")}</p>
    </Panel>
  ),

  // ---------- money ----------
  "fin-numbers": (f) => (
    <KpiRow>
      <StatCard label="Collected today" value={tile(f.collectedToday.paise)} icon={<MenuIconView name="money" />} meta={f.collectedToday.count ? plural(f.collectedToday.count, "receipt") : "Nothing received yet"} href={receiptsHref(f.today, f.today)} />
      <StatCard label="Overdue" value={tile(f.overdue.amountPaise)} icon={<MenuIconView name="clock" />} meta={f.overdue.count ? plural(f.overdue.count, "student") : "Nobody is overdue"} href="/app/fees/dues?overdue=1" />
      <StatCard label="Outstanding" value={tile(f.outstandingPaise)} icon={<MenuIconView name="chart" />} meta="Open on every issued bill" href="/app/fees/dues" />
      {f.counter ? <StatCard label="Your counter" value={f.counter.open ? "Open" : "Closed"} icon={<MenuIconView name="receipt" />} meta={f.counter.open ? `${plural(f.counter.receipts, "receipt")}, ${paise(f.counter.expectedPaise)} cash expected` : "Open it to take money"} href="/app/fees/counter" /> : null}
    </KpiRow>
  ),
  "dues-by-class": (rows) => rows.length === 0 ? <Line title="Dues by class" href="/app/fees/dues">No dues to show.</Line> : (
    <Panel title="Dues by class" action={open("/app/fees/dues", "Open dues")}>
      <HatchedBars height={220} items={rows.map((r) => ({ key: r.classId, label: r.name.replace(/^Class\s+/i, ""), value: r.duePaise / 100, display: formatMoneyCompact(r.duePaise / 100), href: `/app/fees/dues?classId=${r.classId}` }))} />
    </Panel>
  ),
  "overdue": (o) => o.rows.length === 0 ? <Line title="Overdue" href="/app/fees/dues">Nobody is overdue.</Line> : (
    <Panel title="Overdue" action={open("/app/fees/dues?overdue=1", "All overdue")}>
      <EntityList maxItems={6} empty={{ title: "", description: "" }} items={o.rows.map((r) => ({ id: r.id, leading: avatar(r.name), title: r.name, subtitle: `${r.classLabel}${r.nextDueDate ? ` · next due ${shortDate(r.nextDueDate)}` : ""}`, meta: paise(r.overdue), href: `/app/fees/students/${r.id}`,
        action: r.phone ? <a href={`tel:${r.phone}`} className={CALL} aria-label={`Call the family of ${r.name}`}>Call</a> : undefined }))} />
      {o.total > o.rows.length ? <Link href="/app/fees/dues?overdue=1" className={`mt-3 ${LINK}`}>See all {o.total} ({paise(o.amountPaise)})</Link> : null}
    </Panel>
  ),
  "receipts": (rows) => rows.length === 0 ? <Line title="Receipts" href="/app/fees/receipts">No payments recorded yet.</Line> : (
    <Panel title="Recent payments" action={open("/app/fees/receipts", "All receipts")}>
      <EntityList maxItems={8} empty={{ title: "", description: "" }} items={rows.map((p) => ({
        id: p.id, leading: avatar(p.student), title: p.student, subtitle: `${p.receiptNo} · ${shortDate(p.paidOn)}`, meta: paise(p.amountPaise), href: `/app/fees/receipts/${p.id}`,
        badge: <ToneBadge label={METHOD_LABEL[p.method as keyof typeof METHOD_LABEL] ?? p.method} />,
      }))} />
    </Panel>
  ),
  "cheques": (c) => c.received.count + c.deposited.count + c.bounced.count === 0 ? <Line title="Cheques" href="/app/fees/cheques">No cheques waiting.</Line> : (
    <Panel title="Cheques to clear" action={open("/app/fees/cheques", "Open cheques")}>
      <FactList>
        <Fact label="Received, not deposited">{`${c.received.count} (${paise(c.received.paise)})`}</Fact>
        <Fact label="Deposited, not cleared">{`${c.deposited.count} (${paise(c.deposited.paise)})`}</Fact>
        <Fact label="Bounced">{`${c.bounced.count} (${paise(c.bounced.paise)})`}</Fact>
      </FactList>
    </Panel>
  ),
  "payroll": (p) => (
    <Panel title="Payroll" action={open("/app/payroll", "Open payroll")}>
      <p className="text-sm">{p.run ? <>{p.run.label}: <span className="font-medium">{p.run.status}</span>, {plural(p.run.people, "person", "people")}, {paise(p.run.netPaise)} net</> : "No pay run started for this month."}</p>
      {p.next ? <Link href={p.next.href} className={`mt-3 ${LINK}`}>{p.next.text}</Link> : null}
      {p.dueCount ? <Link href="/app/payroll/statutory" className={`mt-2 ${LINK}`}>{plural(p.dueCount, "statutory payment")} coming up</Link> : null}
    </Panel>
  ),

  // ---------- custom roles ----------
  "front-office": (f) => f.rows.length === 0 ? <Line title="Front office" href="/app/enquiries?view=today">No calls or visits due today.</Line> : (
    <Panel title="Front office today" action={open("/app/enquiries?view=today", "Open today's enquiries")}>
      <p className="mb-2 text-xs text-[var(--ds-on-surface-muted)]">{plural(f.calls, "call")} due, {plural(f.visits, "visit")} today.</p>
      <EntityList maxItems={5} empty={{ title: "", description: "" }} items={f.rows.map((r) => ({ id: `${r.enquiryId}${r.label}`, title: r.studentName, subtitle: `${r.parentName} · ${r.label}`, meta: r.at ? `${shortDate(r.at)}, ${time(r.at)}` : undefined, href: `/app/enquiries/${r.enquiryId}`, badge: r.late ? <ToneBadge label="Late" tone="danger" /> : r.visit ? <ToneBadge label="Visit" tone="info" /> : undefined }))} />
    </Panel>
  ),
  "library": (l) => (
    <Panel title="Library desk" action={open("/app/library", "Open library")}>
      <FactList>
        <Fact label="Due today"><Link href="/app/library/loans?status=due-today" className={LINK}>{l.dueToday}</Link></Fact>
        <Fact label="Overdue"><Link href="/app/library/loans?status=overdue" className={LINK}>{l.overdue}</Link></Fact>
        <Fact label="Holds waiting"><Link href="/app/library" className={LINK}>{l.holdsWaiting}</Link></Fact>
        <Fact label="Holds ready"><Link href="/app/library" className={LINK}>{l.holdsReady}</Link></Fact>
      </FactList>
    </Panel>
  ),
  "transport": (t) => t.expiring.length === 0 && t.routes.length === 0 ? <Line title="Transport" href="/app/transport">{t.dayOff ? `No routes today. ${dayOffWords(t.dayOff)}` : "No vehicle papers are due and no route runs today."}</Line> : (
    <Panel title="Transport" action={open("/app/transport", "Open transport")}>
      {t.expiring.length ? (
        <EntityList maxItems={4} empty={{ title: "", description: "" }} items={t.expiring.map((d) => ({ id: d.id, title: `${d.reg}: ${d.kind.replace(/_/g, " ")}`, meta: d.days < 0 ? `Expired ${-d.days} days ago` : d.days === 0 ? "Expires today" : `${d.days} days left`, href: `/app/transport/vehicles/${d.vehicleId}`, badge: d.days < 0 ? <ToneBadge label="Expired" tone="danger" /> : <ToneBadge label="Renew" tone="warning" /> }))} />
      ) : null}
      {t.routes.length ? <p className="mt-3 text-sm text-[var(--ds-on-surface-variant)]">Routes today: {t.routes.map((r, i) => <span key={r.id}>{i ? ", " : ""}<Link href={`/app/transport/routes/${r.id}`} className={LINK}>{r.name}</Link></span>)}</p> : t.dayOff ? <p className="mt-3 text-sm text-[var(--ds-on-surface-muted)]">{dayOffWords(t.dayOff)}</p> : null}
    </Panel>
  ),
  "exam-coordinator": (e) => e.exams.length === 0 ? <Line title="Exam marks" href="/app/exams">No marks are missing.</Line> : (
    <Panel title="Exam marks" action={open("/app/exams", "Open exams")}>
      <EntityList maxItems={4} empty={{ title: "", description: "" }} items={e.exams.map((x) => ({ id: x.examId, title: x.examName, subtitle: plural(x.papers, "paper"), meta: `${x.missing} marks missing`, href: `/app/exams/${x.examId}` }))} />
    </Panel>
  ),
  "cover": (c) => c.dayOff ? <Line title="Cover" href="/app/timetable/substitutions">No classes today. {dayOffWords(c.dayOff)}</Line>
    : c.open === 0 ? <Line title="Cover" href="/app/timetable/substitutions">{c.absent ? "Every period of absent teachers is covered." : "No teacher is away today."}</Line>
    : <Panel title="Cover needed today" action={open("/app/timetable/substitutions", "Open cover")}><p className="text-[26px] font-medium tabular-nums">{c.open}<span className="ml-2 text-sm font-normal text-[var(--ds-on-surface-muted)]">{c.open === 1 ? "period" : "periods"} without a teacher, {plural(c.absent, "teacher")} away</span></p><Link href="/app/timetable/substitutions" className={`mt-3 ${LINK}`}>Choose cover teachers</Link></Panel>,
  "website": (w) => w.state === "live" || w.state === "never"
    ? <Line title="Website" href="/app/website">{w.state === "live" ? "The live site is up to date." : "The site has not been published yet."}</Line>
    : (
      <Panel title="Website" action={open("/app/website", "Open the website")}>
        <p className="text-sm">{w.state === "asked" ? "Changes are waiting for approval to publish." : "Changes are saved as a draft and not live yet."}</p>
        {w.askedNote ? <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{w.askedNote}</p> : null}
        <Link href="/app/website" className={`mt-3 ${LINK}`}>{w.state === "asked" ? "See the request" : "Review and publish"}</Link>
      </Panel>
    ),
  "safeguarding": (s) => <Line title="Safeguarding" href="/app/safeguarding">{s.reports ? `${plural(s.reports, "new report")} to review.` : "No new reports."}</Line>,

};
