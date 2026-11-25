import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NotFoundError, type Ctx } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { AudienceService } from "@smw/feature-notifications/audience";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow, PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { DayService, MeetingService, BookingService, type MeetingDetail, type WindowView } from "../service";
import { dayOf, when } from "../format";
import { addWindows, cancelMeeting, closeMeeting, deleteMeeting, duplicateMeeting, openMeeting, reopenMeeting } from "./actions";
import { FamilyPage } from "./family-page";
import { MeetingForm } from "./meeting-form";
import { WindowEditor } from "./window-editor";
import { MoreMenu } from "@smw/ui/shell/MoreMenu";
import { BackLink, FollowUp, LinkButton, Notice, STATE_LABEL } from "./shared";
import { clock, toIstInput } from "@smw/feature-kit/words";

export const metadata = { title: "Meeting" };
type Query = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const hm = (d: Date) => toIstInput(d).slice(11);

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const [ctx, { id }, sp] = await Promise.all([requireCtx(), params, searchParams]);
  if (ctx.role === "parent") notFound();
  if (ctx.role === "student") return <FamilyPage ctx={ctx} id={id} />;
  const svc = new MeetingService(ctx);
  if (one(sp.child) && svc.canManage) return <FamilyPage ctx={ctx} id={id} studentId={one(sp.child)} />;
  let detail: MeetingDetail;
  try { detail = await svc.get(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  if (one(sp.book) !== undefined && svc.canManage) return <PickFamily ctx={ctx} id={id} title={detail.meeting.title} q={one(sp.q)} />;
  return detail.meeting.state === "draft" ? <Setup ctx={ctx} d={detail} /> : <Overview ctx={ctx} d={detail} />;
}

// ---- setup: the steps of a draft ----

const WINDOW_FIELDS: Field[] = [
  { name: "day", label: "Day", type: "date", required: true },
  { name: "from", label: "From", type: "time", required: true },
  { name: "to", label: "To", type: "time", required: true },
  { name: "place", label: "Room", hint: "Printed on the room sheet." },
  { name: "videoUrl", label: "Video link", hint: "Only if families can join online." },
  { name: "breakFrom", label: "Break from", type: "time", hint: "Optional. No slots are made in a break." },
  { name: "breakTo", label: "Break to", type: "time" },
];

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return <Panel title={`${n}. ${title}`} action={<ToneBadge label={done ? "Done" : "To do"} tone={done ? "success" : "default"} />}><div className="flex flex-col gap-3">{children}</div></Panel>;
}

async function Setup({ ctx, d }: { ctx: Ctx; d: MeetingDetail }) {
  const svc = new MeetingService(ctx);
  const m = d.meeting;
  const manage = svc.canManage;
  if (!manage) return <Notice>This meeting is still being set up by the school office.</Notice>;
  const [options, suggested, staff, check] = await Promise.all([new AudienceService(ctx).options(), svc.suggestTeachers(m.audience), svc.staff(), svc.check(m.id)]);
  const picks = [...suggested.map((t) => ({ value: t.teacherId, label: t.why ? `${t.name} (${t.why})` : t.name })), ...staff.filter((s) => !suggested.some((t) => t.teacherId === s.id)).map((s) => ({ value: s.id, label: s.name }))];
  const form = { id: m.id, title: m.title, note: m.note, audience: m.audience, slotMinutes: m.slotMinutes, perFamily: m.perFamily, opensAt: m.opensAt, closesAt: m.closesAt, locked: false };
  const blocked = check.problems[0];
  return (
    <>
      <BackLink href="/app/meetings">All meetings</BackLink>
      <PageHeader eyebrow="Meeting setup" title={m.title} description="Four steps, then families are told and can book."
        actions={<><MeetingForm options={options} meeting={form} />
          <FormModal title="Copy to a new date" icon="clock" trigger={{ label: "Copy", variant: "ghost" }} fields={[{ name: "date", label: "Date of the first teacher time", type: "date", required: true }, { name: "title", label: "New name", wide: true }]} action={duplicateMeeting} hidden={{ id: m.id }} submitLabel="Make a copy" redirectTo="/app/meetings" />
          <ActionButton variant="ghost" label="Delete draft" action={deleteMeeting} values={{ id: m.id }} redirectTo="/app/meetings" confirm={{ title: "Delete this draft?", body: `"${m.title}" and its teacher times are removed. Nobody has been told about it. This cannot be undone.`, confirmLabel: "Delete", danger: true }}>Delete</ActionButton></>} />
      <div className="flex flex-col gap-3">
        <Step n={1} title="Who it is for and when booking runs" done>
          <p className="text-sm text-[var(--ds-on-surface-variant)]">{d.audienceText}. {m.slotMinutes} minutes each, up to {m.perFamily} {m.perFamily === 1 ? "teacher" : "teachers"} per child. Booking runs from {when(m.opensAt)} to {when(m.closesAt)}.</p>
          {check.families ? <p className="text-sm text-[var(--ds-on-surface-muted)]">{check.families} {check.families === 1 ? "family" : "families"} will be told.</p> : <Notice tone="warning">Nobody is reached yet. Use Edit details to choose who it is for.</Notice>}
        </Step>
        <Step n={2} title="Teachers and their free times" done={d.windows.length > 0}>
          {d.windows.length ? <WindowList meetingId={m.id} windows={d.windows} editable /> : <Notice>No teacher has a time yet. {suggested.length ? `${suggested.length} class and subject teachers of these children are ready to pick.` : "Pick the teachers who will meet families."}</Notice>}
          <div><FormModal title="Add teacher times" icon="clock" size="lg" fields={[{ name: "teacherIds", label: "Teachers", type: "multiselect", required: true, options: picks, wide: true, hint: "Everyone you tick gets the same time. Add another time for different hours." }, ...WINDOW_FIELDS]}
            values={{ teacherIds: suggested.map((t) => t.teacherId), from: "10:00", to: "13:00" }} action={addWindows} hidden={{ meetingId: m.id }} submitLabel="Add times" summary={`${m.slotMinutes}-minute slots are made for each teacher`} /></div>
        </Step>
        <Step n={3} title="Check" done={!check.problems.length && d.windows.length > 0}>
          {[...check.problems.map((p) => ({ p, tone: "danger" as const })), ...check.warnings.map((p) => ({ p, tone: "warning" as const }))].map(({ p, tone }) => <Notice key={p} tone={tone}>{p}</Notice>)}
          {!check.problems.length && !check.warnings.length ? <p className="text-sm text-[var(--ds-on-surface-variant)]">Everything is in place: {d.open} free times for {check.families} families.</p> : null}
        </Step>
        <Step n={4} title="Open booking" done={false}>
          {blocked ? <Notice tone="danger">Not ready: {blocked}</Notice> : (
            <div><ActionButton variant="default" label="Open booking" action={openMeeting} values={{ id: m.id }} confirm={{ title: "Open booking now?", body: `${check.families} families are told right away and can book until ${when(m.closesAt)}. Teacher times can still be changed after, but anyone it drops is told.`, confirmLabel: "Open booking" }}>Open booking to {check.families} families</ActionButton></div>
          )}
        </Step>
      </div>
    </>
  );
}

// ---- after opening: the grid by teacher ----

/** One teacher's time with its slots; on a phone each is a fold-out. */
function WindowList({ meetingId, windows, editable, manage }: { meetingId: string; windows: WindowView[]; editable: boolean; manage?: boolean }) {
  return (
    <ul className="flex flex-col gap-3" aria-label="Teacher times">
      {windows.map((w) => (
        <li key={w.id}>
          <details open={windows.length <= 4} className="rounded-3xl bg-[var(--ds-surface-container-low)] p-4 sm:p-5">
            <summary className="flex min-h-10 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{w.teacherName}</span>
              <span className="text-sm text-[var(--ds-on-surface-muted)]">{dayOf(w.startsAt)}, {clock(w.startsAt)} to {clock(w.endsAt)}{w.place ? ` · ${w.place}` : ""}</span>
              <span className="ml-auto text-sm tabular-nums">{w.booked} of {w.open + w.booked} booked</span>
            </summary>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {manage ? <><LinkButton href={`/app/meetings/${meetingId}/day?teacher=${w.teacherId}`}>Open list</LinkButton><LinkButton href={`/api/meetings/${meetingId}/sheet?teacher=${w.teacherId}`}>Print list</LinkButton></> : null}
              {editable ? <><WindowEditor mode="change" window={{ id: w.id, teacherName: w.teacherName, day: w.day, from: hm(w.startsAt), to: hm(w.endsAt), place: w.place, videoUrl: w.videoUrl }} />
                <WindowEditor mode="remove" window={{ id: w.id, teacherName: w.teacherName, day: w.day, from: hm(w.startsAt), to: hm(w.endsAt), place: w.place, videoUrl: w.videoUrl }} /></> : null}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label={`${w.teacherName}'s slots`}>
              {w.slots.map((s) => (
                <li key={s.id} className={`min-w-0 rounded-2xl px-3 py-2 text-sm ${s.state === "booked" ? "bg-[var(--ds-color-success-500)]/15" : "bg-white/[0.04] text-[var(--ds-on-surface-muted)]"}`}>
                  <span className="tabular-nums">{clock(s.startsAt)}</span>
                  <span className="block truncate">{s.state === "booked" ? `${s.studentName}${s.walkIn ? " (walk-in)" : ""}` : s.state === "break" ? "Break" : "Free"}</span>
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}

async function Overview({ ctx, d }: { ctx: Ctx; d: MeetingDetail }) {
  const svc = new MeetingService(ctx);
  const m = d.meeting;
  const manage = svc.canManage;
  const editable = manage && (m.state === "open" || m.state === "closed");
  const mine = d.windows.some((w) => w.teacherId === ctx.userId);
  const notCame = m.state === "open" || m.state === "closed" || m.state === "done" ? await new DayService(ctx).notCame(m.id) : [];
  const options = manage && editable ? await new AudienceService(ctx).options() : null;
  const form = { id: m.id, title: m.title, note: m.note, audience: m.audience, slotMinutes: m.slotMinutes, perFamily: m.perFamily, opensAt: m.opensAt, closesAt: m.closesAt, locked: true };
  const running = m.state === "open" || m.state === "closed";
  // One main step by state; the rest sit in "More". Each piece is made for either place.
  const steps: Record<string, ((main: boolean) => ReactNode) | null> = {
    list: mine ? (main) => <LinkButton href={`/app/meetings/${m.id}/day`} primary={main}>Open my list</LinkButton> : null,
    book: manage && m.state === "open" ? (main) => <LinkButton href={`/app/meetings/${m.id}?book`} primary={main}>Book for a family</LinkButton> : null,
    reopen: manage && m.state === "closed" ? (main) => <FormModal title="Reopen booking" icon="clock" trigger={{ label: "Reopen booking", variant: main ? "default" : "ghost", plus: false }} fields={[{ name: "closesAt", label: "New closing time", type: "datetime-local", hint: "Leave empty to keep it. Needed if the old time has passed." }]} values={{ closesAt: toIstInput(new Date(Math.max(m.closesAt.getTime(), Date.now() + 2 * 86_400_000))) }} action={reopenMeeting} hidden={{ id: m.id }} submitLabel="Reopen" /> : null,
    close: manage && m.state === "open" ? () => <ActionButton variant="ghost" label="Close booking" action={closeMeeting} values={{ id: m.id }} confirm={{ title: "Close booking?", body: "Families can no longer book or change times. The school office still can. You can reopen it.", confirmLabel: "Close booking" }}>Close booking</ActionButton> : null,
    cancel: manage && running ? () => <FormModal title="Cancel this meeting" icon="clock" trigger={{ label: "Cancel meeting", variant: "ghost", plus: false }} fields={[{ name: "reason", label: "Why", type: "textarea", required: true, hint: "Families who booked read this." }]} action={cancelMeeting} hidden={{ id: m.id }} submitLabel="Cancel the meeting" summary={`${d.booked} booked families and their teachers are told`} /> : null,
    copy: manage && m.state !== "draft" ? (main) => <FormModal title="Copy to a new date" icon="clock" trigger={{ label: "Copy to a new date", variant: main ? "default" : "ghost" }} fields={[{ name: "date", label: "Date of the first teacher time", type: "date", required: true }, { name: "title", label: "New name", wide: true }]} action={duplicateMeeting} hidden={{ id: m.id }} submitLabel="Make a copy" redirectTo="/app/meetings" /> : null,
    edit: options ? () => <MeetingForm options={options} meeting={form} /> : null,
  };
  const main = mine && running ? "list" : steps.book ? "book" : steps.reopen ? "reopen" : m.state === "cancelled" ? "copy" : null;
  const more = Object.entries(steps).filter(([k, make]) => make && k !== main).map(([k, make]) => <div key={k}>{make!(false)}</div>);
  const days = d.windows.length ? `${dayOf(d.windows[0]!.startsAt)}${dayOf(d.windows.at(-1)!.startsAt) !== dayOf(d.windows[0]!.startsAt) ? ` to ${dayOf(d.windows.at(-1)!.startsAt)}` : ""}` : "No times";
  return (
    <>
      <BackLink href="/app/meetings">All meetings</BackLink>
      <PageHeader eyebrow={`${STATE_LABEL[m.state]} · ${days}`} title={m.title} description={manage ? `${d.audienceText}. Booking ${m.state === "open" ? `closes ${when(m.closesAt)}` : `ran ${when(m.opensAt)} to ${when(m.closesAt)}`}.` : "Your times in this meeting."}
        actions={<>
          {main ? steps[main]!(true) : null}
          {more.length ? <MoreMenu>{more}</MoreMenu> : null}
        </>} />
      {m.state === "cancelled" ? <Notice tone="danger">Cancelled{m.cancelReason ? `: ${m.cancelReason}` : "."} Families who had a time were told. Copy it to a new date to run it again.</Notice> : null}
      <div className="mt-3" />
      <KpiRow>
        <StatCard label="Booked" value={String(d.booked)} meta="times taken" />
        <StatCard label="Free" value={String(d.open)} meta="times left" />
        <StatCard label="Waiting" value={String(d.waiting)} meta="families in line" />
        <StatCard label="Teachers" value={String(d.teachers)} meta="with a time" />
      </KpiRow>
      {d.windows.length ? <WindowList meetingId={m.id} windows={d.windows} editable={editable} manage={manage} /> : <Notice>No teacher times in this meeting.</Notice>}
      {notCame.length ? (
        <div className="mt-3"><Panel title={`Did not come or not marked (${notCame.length})`} action={<LinkButton href={`/api/meetings/${m.id}/not-came`} download>Download list</LinkButton>}>
          <ul className="flex flex-col gap-2 text-sm">{notCame.map((r) => <li key={r.slotId} className="flex flex-wrap justify-between gap-2"><span>{r.studentName}{r.studentLabel ? ` (${r.studentLabel})` : ""}{r.phone ? `, ${r.phone}` : ""}</span><span className="flex gap-3 text-[var(--ds-on-surface-muted)]">{r.teacherName}, {when(r.startsAt)} · {r.status}<FollowUp show={ctx.features.has("requests")} studentId={r.studentId} meetingId={m.id} title={m.title} /></span></li>)}</ul>
        </Panel></div>
      ) : null}
      {manage ? <div className="mt-3 flex flex-wrap gap-2"><LinkButton href={`/api/meetings/${m.id}/room`}>Print room sheet</LinkButton></div> : null}
    </>
  );
}

// ---- booking for a family that has no phone ----

async function PickFamily({ ctx, id, title, q }: { ctx: Ctx; id: string; title: string; q?: string }) {
  const kids = (await new BookingService(ctx).invitedChildren(id)).filter((k) => !q || `${k.name} ${k.label}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  return (
    <>
      <BackLink href={`/app/meetings/${id}`}>{title}</BackLink>
      <PageHeader title="Book for a family" description="Find the child, then pick times as the family would." />
      <form className="mb-3 flex gap-2" action={`/app/meetings/${id}`}>
        <input type="hidden" name="book" value="1" />
        <input name="q" defaultValue={q} placeholder="Child's name or class" aria-label="Search children" className="h-10 min-w-0 flex-1 rounded-full bg-white/[0.05] px-4 text-sm outline-none" />
        <button type="submit" className="min-h-10 rounded-full bg-white/[0.07] px-5 text-sm font-medium">Search</button>
      </form>
      {kids.length === 0 ? <Notice>{q ? `Nobody invited matches "${q}".` : "Nobody is invited to this meeting."}</Notice> : (
        <ul className="flex flex-col gap-2">{kids.map((k) => <li key={k.id}><a href={`/app/meetings/${id}?child=${k.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-[var(--ds-surface-container-low)] px-4 text-sm hover:bg-white/[0.08]"><span>{k.name}</span><span className="text-[var(--ds-on-surface-muted)]">{k.label}</span></a></li>)}</ul>
      )}
    </>
  );
}
