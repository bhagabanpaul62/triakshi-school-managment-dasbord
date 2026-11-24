import Link from "next/link";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { SegmentedGauge } from "@smw/ui/kit/SegmentedGauge";
import { StatCard } from "@smw/ui/kit/StatCard";
import { SummaryRows } from "@smw/ui/kit/SummaryRows";
import { TickBar } from "@smw/ui/kit/TickBar";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { tilePaise as tile } from "@smw/ui/format";
import type { AdminHome } from "../home-service";
import { attendanceTone, isSunday, plural, planTone } from "../rules";
import { FeeTrend } from "./fee-trend";
import { PanelRow, Rows, SlotPanel } from "./layout";
import { AnnouncementsBody, EventsBody, NextStep, open } from "./parts";

const ICON = { attendance: "check", fees: "money", marks: "exam", support: "support", enquiries: "inbox" } as const;

export function AdminHomeView({ d }: { d: AdminHome }) {
  const cap = d.capacity.state === "ok" ? d.capacity.data : null;
  const att = d.attendance.state === "ok" ? d.attendance.data : null;
  const fees = d.fees.state === "ok" ? d.fees.data.summary : null;

  return (
    <>
      <KpiRow>
        {cap ? <StatCard label="Students" value={String(cap.active)} icon={<MenuIconView name="users" />} meta={`of ${cap.cap} on your plan`} href="/app/students" /> : null}
        {att ? <StatCard label="Attendance today" value={att.pct === null ? "-" : `${Math.round(att.pct)}%`} icon={<MenuIconView name="check" />} meta={att.marked ? `${plural(att.absent, "student")} absent` : isSunday(att.date) ? "Sunday, no classes" : "Not marked yet"} href="/app/attendance" /> : null}
        {fees ? <StatCard label="Collected this month" value={tile(fees.collectedThisMonth)} icon={<MenuIconView name="money" />} meta={plural(fees.receiptsThisMonth, "receipt")} href="/app/fees" /> : null}
        {fees ? <StatCard label="Outstanding" value={tile(fees.outstanding)} icon={<MenuIconView name="receipt" />} meta={fees.overdueCount ? `${plural(fees.overdueCount, "student")} overdue` : "Nobody is overdue"} href="/app/fees/dues?overdue=1" /> : null}
      </KpiRow>
      <Rows>
        <PanelRow cells={[
          { slot: d.attention, size: 7, node: (
            <SlotPanel slot={d.attention} title="Needs attention">
              {({ items, unchecked }) => (
                <>
                  {items.length === 0 ? (
                    <WidgetEmptyState title="Nothing needs you right now." description="Attendance, fees, exams and support are all up to date." />
                  ) : (
                    <SummaryRows rows={items.map((i) => ({ key: i.key, label: i.label, value: String(i.count), tone: i.tone, href: i.href, icon: <MenuIconView name={ICON[i.key as keyof typeof ICON]} /> }))} />
                  )}
                  {unchecked.length ? <p className="mt-3 text-xs text-[var(--ds-color-warning-400)]">Could not check {unchecked.join(", ")}. Refresh to try again.</p> : null}
                </>
              )}
            </SlotPanel>
          ) },
          { slot: d.attendance, size: 5, node: (
            <SlotPanel slot={d.attendance} title="Attendance today" action={open("/app/attendance", "Open attendance")}>
              {(a) => a.marked === 0 && isSunday(a.date) ? (
                <WidgetEmptyState title="No classes today." description="It is Sunday. Attendance starts again on Monday." />
              ) : a.marked === 0 ? (
                <>
                  <WidgetEmptyState title="Attendance is not marked yet." description="Class teachers mark it from the Attendance page. It shows here as they save." />
                  <NextStep href="/app/attendance">Open attendance</NextStep>
                </>
              ) : (
                <>
                  <SegmentedGauge value={a.pct ?? 0} tone={a.pct === null ? "info" : attendanceTone(a.pct)} label="present today" caption={`${a.marked} of ${a.students} students marked`} />
                  <FactList className="mt-4">
                    <Fact label="Absent">{String(a.absent)}</Fact>
                    <Fact label="Late">{String(a.late)}</Fact>
                    <Fact label="On leave">{String(a.leave)}</Fact>
                  </FactList>
                </>
              )}
            </SlotPanel>
          ) },
        ]} />
        <PanelRow cells={[
          { slot: d.fees, size: 7, node: (
            <SlotPanel slot={d.fees} title="Fee collection" action={open("/app/fees", "Open fees")}>
              {({ trend }) => trend.every((p) => p.paise === 0) ? (
                <>
                  <WidgetEmptyState title="No payments recorded yet." description="Collection shows here month by month once the first fee is received." />
                  <NextStep href="/app/fees">Open fees</NextStep>
                </>
              ) : <FeeTrend points={trend.map((p) => ({ label: p.label, paise: p.paise }))} />}
            </SlotPanel>
          ) },
          { slot: d.capacity, size: 5, node: (
            <SlotPanel slot={d.capacity} title="Plan usage" action={open("/app/billing", "Open billing")}>
              {(c) => (
                <div className="flex flex-1 flex-col justify-between gap-5">
                  <div>
                    <p className="text-[26px] font-medium tabular-nums tracking-tight">{c.active}<span className="ml-2 text-sm font-normal text-[var(--ds-on-surface-muted)]">of {c.cap} students</span></p>
                    <div className="mt-4"><TickBar value={c.percent} tone={planTone(c.active, c.cap)} /></div>
                    <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">{c.percent}% of your plan is in use</p>
                  </div>
                  {c.message ? (
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-[var(--ds-on-surface-variant)]">{c.message}</p>
                      <ToneBadge label={c.blocked ? "Full" : "Near limit"} tone={c.blocked ? "danger" : "warning"} />
                    </div>
                  ) : <p className="text-sm text-[var(--ds-on-surface-variant)]">{c.cap - c.active} places left before you reach your plan limit.</p>}
                  {c.warning ? <Link href="/app/billing" className="text-sm text-[var(--ds-color-primary-300)] underline-offset-4 hover:underline">See plans</Link> : null}
                </div>
              )}
            </SlotPanel>
          ) },
        ]} />
        <PanelRow cells={[
          { slot: d.announcements, size: 7, node: <SlotPanel slot={d.announcements} title="Latest announcements" action={open("/app/announcements", "All announcements")}>{(rows) => <AnnouncementsBody rows={rows} />}</SlotPanel> },
          { slot: d.events, size: 5, node: <SlotPanel slot={d.events} title="Upcoming events" action={open("/app/events", "Open events")}>{(rows) => <EventsBody rows={rows} />}</SlotPanel> },
        ]} />
      </Rows>
    </>
  );
}
