import { notFound } from "next/navigation";
import { ConflictError, ForbiddenError, NotFoundError, type Ctx } from "@smw/feature-kit";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { BookingService, type BookedView, type BookingView, type KidView, type TeacherView } from "../service";
import { dayLong, dayOf, when } from "../format";
import { bookSlot, cancelSlot, changeSlot, joinWait, leaveWait } from "./actions";
import { BackLink, Notice, STATE_LABEL } from "./shared";
import { clock } from "@smw/feature-kit/words";

/** Times of one teacher, grouped by day, each one a single tap that books it. */
function Times({ slots, run }: { slots: TeacherView["slots"]; run: (slotId: string, label: string) => React.ReactNode }) {
  const days = [...new Set(slots.map((s) => dayOf(s.startsAt)))];
  return (
    <div className="flex flex-col gap-2">
      {days.map((day) => (
        <div key={day}>
          <p className="mb-1 text-xs text-[var(--ds-on-surface-muted)]">{day}</p>
          <div className="flex flex-wrap gap-2">{slots.filter((s) => dayOf(s.startsAt) === day).map((s) => <span key={s.id}>{run(s.id, clock(s.startsAt))}</span>)}</div>
        </div>
      ))}
    </div>
  );
}

function BookedCard({ b, kid, meetingId, studentId, can }: { b: BookedView; kid: KidView; meetingId: string; studentId?: string; can: boolean }) {
  const who: Record<string, string> = studentId ? { studentId } : {};
  const teacher = kid.teachers.find((t) => t.teacherId === b.teacherId);
  return (
    <li className="rounded-2xl bg-[var(--ds-color-success-500)]/10 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{b.teacherName}</p>
        <p className="text-sm tabular-nums">{dayLong(b.startsAt)}, {clock(b.startsAt)} to {clock(b.endsAt)}</p>
      </div>
      <p className="mt-1 text-sm text-[var(--ds-on-surface-variant)]">{b.place ?? "Place to be announced"}{b.videoUrl ? <> · <a href={b.videoUrl} className="underline" target="_blank" rel="noreferrer">Join by video</a></> : null}</p>
      {b.endsAt > new Date() ? <p className="mt-2"><a href={`/api/calendar/slot/${b.slotId}.ics`} className="text-sm underline">Add to calendar</a></p> : null}
      {b.remark ? <p className="mt-3 rounded-xl bg-white/[0.06] p-3 text-sm"><span className="block text-xs text-[var(--ds-on-surface-muted)]">Note from {b.teacherName}</span>{b.remark}</p> : null}
      {can ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {teacher?.slots.length ? (
            <details className="w-full sm:w-auto">
              <summary className="inline-flex min-h-10 cursor-pointer items-center rounded-full bg-white/[0.07] px-5 text-sm font-medium">Change time</summary>
              <div className="mt-2"><Times slots={teacher.slots} run={(slotId, label) => (
                <ActionButton label={`Move to ${label}`} action={changeSlot} values={{ meetingId, fromSlotId: b.slotId, toSlotId: slotId, ...who }} successMessage="Time changed">{label}</ActionButton>)} /></div>
            </details>
          ) : <span className="text-sm text-[var(--ds-on-surface-muted)]">No other free time with this teacher.</span>}
          <ActionButton variant="ghost" label={`Cancel ${b.teacherName}`} action={cancelSlot} values={{ meetingId, slotId: b.slotId, ...who }} successMessage="Time cancelled"
            confirm={{ title: "Cancel this time?", body: `${kid.student.name}'s meeting with ${b.teacherName} on ${when(b.startsAt)} is given up and another family can take it.`, confirmLabel: "Cancel the time" }}>Cancel</ActionButton>
        </div>
      ) : null}
    </li>
  );
}

function TeacherCard({ t, kid, meetingId, studentId, can }: { t: TeacherView; kid: KidView; meetingId: string; studentId?: string; can: boolean }) {
  const who: Record<string, string> = studentId ? { studentId } : {};
  const atLimit = kid.used >= kid.limit;
  return (
    <li className="rounded-2xl bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{t.name}</p>
        <p className="text-sm text-[var(--ds-on-surface-muted)]">{t.why}{t.place ? ` · ${t.place}` : ""}</p>
      </div>
      <div className="mt-3">
        {!can ? <p className="text-sm text-[var(--ds-on-surface-muted)]">{t.slots.length} free times</p>
          : atLimit ? <Notice>You have booked {kid.limit} {kid.limit === 1 ? "teacher" : "teachers"}, the most for one child. Cancel one to pick another.</Notice>
          : t.slots.length ? <Times slots={t.slots} run={(slotId, label) => <ActionButton label={`Book ${t.name} at ${label}`} action={bookSlot} values={{ meetingId, slotId, ...who }} successMessage="Time booked">{label}</ActionButton>} />
          : t.waiting ? (
            <div className="flex flex-wrap items-center gap-3"><ToneBadge label="On the waiting list" tone="info" />
              <ActionButton variant="ghost" label={`Leave the waiting list for ${t.name}`} action={leaveWait} values={{ meetingId, teacherId: t.teacherId, ...who }}>Leave the list</ActionButton></div>
          ) : (
            <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-[var(--ds-on-surface-muted)]">All times are taken or clash with another meeting.</span>
              <ActionButton label={`Join the waiting list for ${t.name}`} action={joinWait} values={{ meetingId, teacherId: t.teacherId, ...who }}>Tell me if a time frees up</ActionButton></div>
          )}
      </div>
    </li>
  );
}

/** The family's booking page: each child, the times already booked first, then the teachers who teach them. Staff reach it with `studentId`. */
export async function FamilyPage({ ctx, id, studentId }: { ctx: Ctx; id: string; studentId?: string }) {
  const svc = new BookingService(ctx);
  let v: BookingView;
  try { v = studentId ? await svc.forStudent(id, studentId) : await svc.forFamily(id); }
  catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError || e instanceof ConflictError) return <Notice tone="warning">{e.message}</Notice>;
    throw e;
  }
  const m = v.meeting;
  return (
    <>
      <BackLink href={studentId ? `/app/meetings/${id}?book` : "/app/meetings"}>{studentId ? "Pick another child" : "All meetings"}</BackLink>
      <PageHeader eyebrow={`Meeting · ${STATE_LABEL[m.state]}`} title={m.title}
        description={m.note ?? (m.state === "open" ? `Booking is open until ${when(m.closesAt)}.` : undefined)} />
      {v.why ? <Notice tone={m.state === "cancelled" ? "danger" : "warning"}>{v.why}</Notice> : null}
      <div className="mt-3 flex flex-col gap-3">
        {v.kids.length === 0 ? <Notice>No child is linked to this login right now. Ask the school office.</Notice> : null}
        {v.kids.map((kid) => (
          <Panel key={kid.student.id} title={`${kid.student.name}${kid.student.label ? ` · ${kid.student.label}` : ""}`} action={<span className="text-sm tabular-nums text-[var(--ds-on-surface-muted)]">{kid.used} booked, up to {kid.limit}</span>}>
            <div className="flex flex-col gap-5">
              {kid.booked.length ? (
                <section aria-label="Your times"><h3 className="mb-2 text-sm font-medium">Booked</h3>
                  <ul className="flex flex-col gap-3">{kid.booked.map((b) => <BookedCard key={b.slotId} b={b} kid={kid} meetingId={id} studentId={studentId} can={v.can} />)}</ul></section>
              ) : null}
              <section aria-label="Teachers"><h3 className="mb-2 text-sm font-medium">{kid.booked.length ? "Other teachers" : "Pick a time with a teacher"}</h3>
                {kid.teachers.length === 0 ? <Notice>None of {kid.student.name}'s teachers have a time in this meeting. Ask the school office to add them.</Notice> : (
                  <ul className="flex flex-col gap-3">{kid.teachers.filter((t) => !t.booked).map((t) => <TeacherCard key={t.teacherId} t={t} kid={kid} meetingId={id} studentId={studentId} can={v.can} />)}</ul>
                )}
                {kid.teachers.length > 0 && kid.teachers.every((t) => t.booked) ? <p className="text-sm text-[var(--ds-on-surface-muted)]">{kid.notInMeeting.length ? `You have a time with every teacher in this meeting. ${kid.notInMeeting.join(", ")} ${kid.notInMeeting.length === 1 ? "has" : "have"} no time in it.` : "You have a time with every teacher."}</p> : null}
              </section>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
