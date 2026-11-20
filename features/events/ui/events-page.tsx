import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { istDay } from "../dates";
import { EventService } from "../service";
import { createEvent } from "./actions";
import { EventActions } from "./event-actions";
import { AUDIENCE_LABELS, audienceOptions, eventFields, toView } from "./fields";
import { MonthCalendar } from "./month-calendar";
import { ViewToggle } from "./view-toggle";
import { whenLabel } from "./when";

export const metadata = { title: "Events" };

const columns: Column[] = [
  { key: "title", label: "Event" },
  { key: "when", label: "When" },
  { key: "kind", label: "Type", type: "badge", tones: { Holiday: "warning" }, hideOnMobile: true },
  { key: "audience", label: "Audience", type: "badge", labels: AUDIENCE_LABELS, hideOnMobile: true },
  { key: "isPublicLabel", label: "Website", type: "badge", tones: { Public: "info" }, hideOnMobile: true },
];

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function EventsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const ctx = await requireCtx();
  const svc = new EventService(ctx);
  const canWrite = svc.can("write");
  const month = typeof params.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : istDay(new Date()).slice(0, 7);
  const view = params.view === "month" ? "month" : "list";

  const classes = await svc.classOptions();
  const create = <FormModal title="New event" icon="event" fields={eventFields(classes)} action={createEvent} submitLabel="Add event" values={{ audience: "all", tone: "default" }} />;
  const header = (
    <PageHeader eyebrow="Communication" title="Events" description="The school calendar: programmes, exams and holidays."
      actions={<><ViewToggle view={view} />{canWrite ? create : null}</>} />
  );

  if (view === "month") {
    const events = (await svc.month(month)).map(toView);
    return <>{header}<MonthCalendar month={month} today={istDay(new Date())} events={events} canWrite={canWrite} classes={classes} /></>;
  }

  const query = listQueryFrom(params);
  if (!params.dir) query.dir = "asc"; // a calendar reads soonest first
  const page = await svc.list(query);
  const rows = page.rows.map((r) => { const v = toView(r); return { ...v, when: whenLabel(v), kind: v.isHoliday ? "Holiday" : "Event", isPublicLabel: v.isPublic ? "Public" : null }; });

  return (
    <>
      {header}
      <div className="relative min-w-0 overflow-x-clip">
        <DataTable
          columns={columns}
          rows={rows}
          total={page.total}
          page={page.page}
          pageCount={page.pageCount}
          searchPlaceholder="Search events"
          filters={[
            { key: "when", label: "When", options: [{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }] },
            { key: "kind", label: "Type", options: [{ value: "event", label: "Events" }, { value: "holiday", label: "Holidays" }] },
            { key: "audience", label: "Audience", options: audienceOptions.filter((o) => o.value !== "class") },
          ]}
          empty={{ title: "No events yet.", description: "Add one so families, students and staff can plan around it.", action: canWrite ? create : undefined }}
          rowActions={canWrite ? Object.fromEntries(rows.map((r) => [r.id, <EventActions key={r.id} event={r} classes={classes} />])) : undefined}
        />
      </div>
    </>
  );
}
