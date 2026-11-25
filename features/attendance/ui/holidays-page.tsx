import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { templateCsv } from "../holiday-import";
import { HolidayService } from "../holiday-service";
import { todayIST } from "../stats";
import { checkHolidayImport, commitHolidayImport } from "./actions";
import { addHolidays, createHoliday } from "./holiday-actions";
import { holidayFields } from "./fields";
import { urgentAlertHref } from "./urgent-alert";
import { HolidayImportForm } from "./holiday-import-form";
import { HolidayList } from "./holiday-list";
import { HolidayPicker } from "./holiday-picker";
import { AttendanceNav } from "./nav";
import { attendanceNavFor } from "./pages";
import { QueryPicker } from "./QueryPicker";
import { WorkingDaysPanel } from "./working-days-panel";

export const metadata = { title: "Holidays" };

/** /app/attendance/holidays: days the school is closed (or open on a Sunday). One list, shared with the calendar. */
export default async function HolidaysPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new HolidayService(ctx);
  // Families and staff without attendance access cannot open this list. They are not sent to an error: the calendar already shows their holidays.
  if (!svc.can("read")) {
    return (
      <>
        <PageHeader eyebrow="Academics" title="Holidays" description="The days the school is closed." />
        <Panel>
          <WidgetEmptyState title="Holidays are on the calendar" description="Closed days show there as the Holidays layer. For anything else, ask the school office." />
          <div className="flex justify-center pb-6"><Link href="/app/events?layers=holidays" className="rounded-full bg-[var(--ds-surface-container-high)] px-4 py-2 text-sm font-medium">Open the calendar</Link></div>
        </Panel>
      </>
    );
  }
  const asked = (await searchParams).year;
  const [years, classes, current] = await Promise.all([svc.years(), svc.classOptions(), svc.workingDays()]);
  const year = years.find((y) => y.id === asked) ?? current.year ?? years[0] ?? null;
  const [markedToday, days, spans, ideas] = await Promise.all([
    svc.markedToday(),
    year?.id === current.year?.id ? current : svc.workingDays(year?.id),
    svc.spans(year ? { from: year.startsOn, to: year.endsOn } : undefined),
    svc.suggestions(year?.id),
  ]);
  await svc.seeDeclared(spans.map((s) => s.id));
  const canWrite = svc.can("manage");
  const today = todayIST();
  // Today is marked already, so a closure for today is refused: the way out sits next to the Add button, not behind the refusal.
  const marked = markedToday ? (
    <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--ds-on-surface-muted)]">
      Today is already marked in {markedToday} {markedToday === 1 ? "section" : "sections"}.
      <Link href={urgentAlertHref("School is closed today")} className="rounded-full bg-white/[0.07] px-3 py-2 text-sm font-medium text-[var(--ds-on-surface)] hover:bg-white/[0.12]">Send an urgent alert instead</Link>
      <Link href="/app/attendance" className="underline">To close today, clear the marks in the register</Link>
    </span>
  ) : undefined;
  const create = <FormModal title="Add holiday" icon="calendar" fields={holidayFields(classes, { notify: true })} values={{ kind: "other", appliesTo: "all", notify: true }} action={createHoliday} submitLabel="Add" size="lg" summary={marked} />;
  const newCopy = ideas.copy.filter((c) => !c.clash), newNational = ideas.national.filter((c) => !c.clash);

  return (
    <>
      <PageHeader eyebrow="Academics" title="Holidays" description="Closed days cannot be marked. The calendar shows the same list." actions={canWrite ? create : undefined} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <AttendanceNav items={attendanceNavFor(ctx)} active="/app/attendance/holidays" />
        {years.length > 1 && year ? <QueryPicker key={year.id} fields={[{ name: "year", label: "Year", type: "select", value: year.id, options: years.map((y) => ({ value: y.id, label: y.name })) }]} /> : null}
      </div>
      <div className="flex flex-col gap-3">
        <WorkingDaysPanel yearName={days.year?.name ?? null} bands={days.bands} />
        {spans.length === 0 ? (
          <Panel>
            <WidgetEmptyState title="No holidays in this year yet." description="Add the days the school is closed, or fill the year with the tools below." />
            {canWrite ? <div className="flex justify-center pb-6">{create}</div> : null}
          </Panel>
        ) : <HolidayList spans={spans} classes={classes} canWrite={canWrite} />}
        {canWrite ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="National days">
              {newNational.length ? <HolidayPicker key={newNational.map((n) => n.data.from).join()} items={newNational} action={addHolidays} cta="Add ticked days" today={today} />
                : <p className="text-sm text-[var(--ds-on-surface-muted)]">Republic Day, Independence Day and Gandhi Jayanti are already in this year.</p>}
            </Panel>
            <Panel title={`Copy from last year`}>
              {newCopy.length ? <HolidayPicker key={newCopy.map((n) => n.data.from).join()} items={newCopy} action={addHolidays} cta="Add ticked days" today={today} />
                : <p className="text-sm text-[var(--ds-on-surface-muted)]">Nothing to copy: last year has no other holidays, or they are already here.</p>}
            </Panel>
            <Panel title="Add from a sheet" className="lg:col-span-2">
              <HolidayImportForm check={checkHolidayImport} commit={commitHolidayImport} template={templateCsv()} />
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}
