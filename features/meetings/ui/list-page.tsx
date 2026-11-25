import { notFound } from "next/navigation";
import { listQueryFrom, type Ctx } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { MeetingService, type MeetingRow } from "../service";
import { dayOf } from "../format";
import { AudienceService } from "@smw/feature-notifications/audience";
import { MeetingForm } from "./meeting-form";
import { LinkButton, Notice, STATE_LABEL, STATE_TONE } from "./shared";
import { plural } from "@smw/feature-kit/words";

export const metadata = { title: "Meetings" };

const columns: Column[] = [
  { key: "title", label: "Meeting" },
  { key: "days", label: "When" },
  { key: "teachers", label: "Teachers", type: "number", hideOnMobile: true },
  { key: "bookedText", label: "Booked", hideOnMobile: true },
  { key: "state", label: "State", type: "badge", tones: STATE_TONE, labels: STATE_LABEL },
];

const span = (m: MeetingRow) => (m.firstAt ? (dayOf(m.firstAt) === dayOf(m.lastAt!) ? dayOf(m.firstAt) : `${dayOf(m.firstAt)} to ${dayOf(m.lastAt!)}`) : "No times yet");

/** The one next step for a meeting in each state, as plain text on the button. */
function nextStep(m: MeetingRow, manage: boolean): { label: string; href: string } {
  if (!manage) return { label: "Open my list", href: `/app/meetings/${m.id}/day` };
  const base = `/app/meetings/${m.id}`;
  return {
    draft: { label: "Continue setup", href: base },
    open: { label: "See bookings", href: base },
    closed: { label: "Reopen or review", href: base },
    done: { label: "Who did not come", href: base },
    cancelled: { label: "Copy to a new date", href: base },
  }[m.state];
}

/** /app/meetings: managers and teachers get a table, families get their invitations. */
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  if (ctx.role === "parent") notFound();
  return ctx.role === "student" ? <FamilyList ctx={ctx} /> : <StaffList ctx={ctx} searchParams={await searchParams} />;
}

async function StaffList({ ctx, searchParams }: { ctx: Ctx; searchParams: Record<string, string | string[] | undefined> }) {
  const svc = new MeetingService(ctx);
  const page = await svc.list(listQueryFrom(searchParams));
  const manage = svc.canManage;
  const create = manage ? <MeetingForm options={await new AudienceService(ctx).options()} /> : null;
  const rows = page.rows.map((m) => ({ ...m, days: span(m), bookedText: m.slots ? `${m.booked} of ${m.slots}` : null }));
  return (
    <>
      <PageHeader eyebrow="Communication" title="Meetings" description="Parent-teacher meetings: who is invited, when teachers are free, and who has booked." actions={create} />
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/meetings/{id}" searchPlaceholder="Search meetings"
        filters={[{ key: "state", label: "State", options: Object.entries(STATE_LABEL).filter(([k]) => manage || k !== "draft").map(([value, label]) => ({ value, label })) }]}
        rowActions={Object.fromEntries(page.rows.map((m) => { const n = nextStep(m, manage); return [m.id, <LinkButton key={m.id} href={n.href} primary={m.state === "open" || m.state === "draft"}>{n.label}</LinkButton>]; }))}
        empty={manage
          ? { title: "No meetings yet.", description: "Plan one: choose who it is for, add the teachers and their free times, then open booking.", action: create }
          : { title: "No meeting has your name on it.", description: "When the school plans a meeting and gives you a time, it shows here. Ask the school office if you expected one." }} />
    </>
  );
}

async function FamilyList({ ctx }: { ctx: Ctx }) {
  const page = await new MeetingService(ctx).list({ pageSize: 50 });
  return (
    <>
      <PageHeader eyebrow="Communication" title="Meetings" description="Book a time with your child's teachers." />
      {page.rows.length === 0 ? (
        <Panel title="Nothing to book right now"><Notice>No meeting is open for your child. When the school opens booking you will get a notice here and on your phone.</Notice></Panel>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Meetings">
          {page.rows.map((m) => (
            <li key={m.id} className="flex flex-col gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-medium">{m.title}</h2>
                <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">{span(m)}{m.mine ? ` · you have ${plural(m.mine, "time")}` : ""}</p>
                <div className="mt-2"><ToneBadge label={STATE_LABEL[m.state]} tone={STATE_TONE[m.state]} /></div>
              </div>
              <LinkButton href={`/app/meetings/${m.id}`} primary={m.state === "open"}>{m.state === "open" ? (m.mine ? "See my times" : "Book a time") : m.state === "done" ? "See notes" : "Open"}</LinkButton>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
