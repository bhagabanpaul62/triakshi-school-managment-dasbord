import { notFound } from "next/navigation";
import { ConflictError, ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import type { Tone } from "@smw/ui/tone";
import { DayService, type DayRow, type DayView } from "../service";
import type { VisitState } from "../constants";
import { clock, dayLong, when } from "../format";
import { addWalkIn, markVisit, saveNotes } from "./actions";
import { BackLink, FollowUp, LinkButton, Notice } from "./shared";

export const metadata = { title: "My meeting day" };

const VISIT: Record<VisitState, { label: string; tone: Tone }> = { came: { label: "Came", tone: "success" }, late: { label: "Came late", tone: "warning" }, missed: { label: "Did not come", tone: "danger" } };

function Row({ r, v, next, followUp }: { r: DayRow; v: DayView; next: boolean; followUp: boolean }) {
  const fields: Field[] = [
    ...(v.privateNotesHidden ? [] : [{ name: "privateNote", label: "Private note", type: "textarea" as const, wide: true, hint: "Only staff see this. It never reaches the family." }]),
    { name: "sharedRemark", label: "Remark for the family", type: "textarea", wide: true, hint: "The family reads this after the meeting time is over." },
  ];
  return (
    <li id={r.slotId} className={`rounded-3xl p-4 sm:p-5 ${next ? "bg-[var(--ds-surface-container-high,rgba(255,255,255,0.1))] ring-2 ring-[var(--ds-primary)]" : "bg-[var(--ds-surface-container-low)]"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-lg font-medium tabular-nums">{clock(r.startsAt)}</span>
        <span className="min-w-0 flex-1 truncate text-base">{r.studentName}{r.studentLabel ? <span className="text-sm text-[var(--ds-on-surface-muted)]"> · {r.studentLabel}</span> : null}</span>
        {r.isNow ? <ToneBadge label="Now" tone="info" /> : next ? <ToneBadge label="Up next" tone="info" /> : null}
        {r.walkIn ? <ToneBadge label="Walk-in" /> : null}
        {r.visit ? <ToneBadge label={VISIT[r.visit].label} tone={VISIT[r.visit].tone} /> : null}
      </div>
      {r.sharedRemark || r.privateNote ? (
        <div className="mt-2 text-sm text-[var(--ds-on-surface-variant)]">
          {r.privateNote ? <p><span className="text-[var(--ds-on-surface-muted)]">Private: </span>{r.privateNote}</p> : null}
          {r.sharedRemark ? <p><span className="text-[var(--ds-on-surface-muted)]">For family: </span>{r.sharedRemark}</p> : null}
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        {(Object.keys(VISIT) as VisitState[]).map((k) => (
          <ActionButton key={k} variant={r.visit === k ? "default" : next && k === "came" ? "default" : "secondary"} label={`${VISIT[k].label}: ${r.studentName}`} action={markVisit} values={{ slotId: r.slotId, visit: r.visit === k ? "" : k }}>
            <span className="inline-flex min-h-8 items-center">{k === "came" ? "Came" : k === "late" ? "Late" : "Missed"}</span>
          </ActionButton>
        ))}
        <FormModal title={`Notes: ${r.studentName}`} icon="clock" fields={fields} values={{ privateNote: r.privateNote ?? "", sharedRemark: r.sharedRemark ?? "" }} action={saveNotes} hidden={{ slotId: r.slotId }} trigger={{ label: "Notes", variant: "ghost" }} submitLabel="Save notes" />
        {r.endsAt <= v.now ? <FollowUp show={followUp} studentId={r.studentId} meetingId={v.meeting.id} title={v.meeting.title} /> : null}
      </div>
    </li>
  );
}

/** /app/meetings/{id}/day: one teacher's list in order, big buttons, usable with one hand on a phone. */
export default async function DayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ctx, { id }, sp] = await Promise.all([requireCtx(), params, searchParams]);
  if (ctx.role === "student" || ctx.role === "parent") notFound();
  const svc = new DayService(ctx);
  const followUp = ctx.features.has("requests");
  const teacher = Array.isArray(sp.teacher) ? sp.teacher[0] : sp.teacher;
  let v: DayView;
  try { v = await svc.day(id, teacher); }
  catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ConflictError || e instanceof ForbiddenError) return <><BackLink href={`/app/meetings`}>All meetings</BackLink><Notice tone="warning">{e.message}</Notice></>;
    throw e;
  }
  const [choices, notCame] = await Promise.all([svc.walkInChoices(id), svc.notCame(id)]);
  const mine = notCame.filter((r) => r.teacherName === v.teacher.name);
  const running = v.meeting.state === "open" || v.meeting.state === "closed";
  const c = v.counts;
  return (
    <>
      <BackLink href={svc.canManage ? `/app/meetings/${id}` : "/app/meetings"}>{v.meeting.title}</BackLink>
      <PageHeader eyebrow={`${v.teacher.name}${v.place ? ` · ${v.place}` : ""}`} title="My meeting day" description={`${dayLong(v.now)}. ${c.booked} booked, ${c.came + c.late} came, ${c.unmarked} not marked, ${v.free} free times left.`}
        actions={<>
          {running ? <FormModal title="Add a walk-in" icon="clock" trigger={{ label: "Add a walk-in" }} fields={[{ name: "studentId", label: "Child", type: "select", required: true, options: choices.map((k) => ({ value: k.id, label: `${k.name}${k.label ? ` (${k.label})` : ""}` })), wide: true }]}
            action={addWalkIn} hidden={{ meetingId: id, ...(teacher ? { teacherId: teacher } : {}) }} submitLabel="Add and mark as came" summary="Takes the next ten minutes of your time" /> : null}
          <LinkButton href={`/api/meetings/${id}/sheet${teacher ? `?teacher=${teacher}` : ""}`}>Print my list</LinkButton>
        </>} />
      {v.teachers.length > 1 ? <nav aria-label="Teachers" className="mb-3 flex flex-wrap gap-2">{v.teachers.map((t) => <LinkButton key={t.id} href={`/app/meetings/${id}/day?teacher=${t.id}`} primary={t.id === v.teacher.id}>{t.name}</LinkButton>)}</nav> : null}
      {v.privateNotesHidden ? <Notice>This is a support session: private notes are hidden and cannot be written.</Notice> : null}
      {v.rows.length === 0 ? (
        <Panel title="Nobody has booked yet"><Notice>{v.free ? `${v.free} free times are waiting. Families book from their meetings page.` : "No free times left either. Ask the school office to widen your time."}{svc.canManage ? " You can book for a family from the meeting page." : ""}</Notice></Panel>
      ) : (
        <ol className="mt-3 flex flex-col gap-3" aria-label="Today's list">{v.rows.map((r) => <Row key={r.slotId} r={r} v={v} next={r.slotId === v.nextSlotId} followUp={followUp} />)}</ol>
      )}
      {mine.length ? (
        <div className="mt-3"><Panel title={`Did not come or not marked (${mine.length})`} action={<LinkButton href={`/api/meetings/${id}/not-came`} download>Download list</LinkButton>}>
          <ul className="flex flex-col gap-2 text-sm">{mine.map((r) => <li key={r.slotId} className="flex flex-wrap justify-between gap-2"><span>{r.studentName}{r.phone ? `, ${r.phone}` : ""}</span><span className="flex gap-3 text-[var(--ds-on-surface-muted)]">{when(r.startsAt)} · {r.status}<FollowUp show={followUp} studentId={r.studentId} meetingId={id} title={v.meeting.title} /></span></li>)}</ul>
        </Panel></div>
      ) : null}
    </>
  );
}
