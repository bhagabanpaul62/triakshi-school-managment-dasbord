import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { MenuLink, MoreMenu } from "@smw/ui/shell/MoreMenu";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Panel, Inset } from "@smw/ui/kit/Panel";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { StatusTrack, type TrackStep } from "@smw/ui/finance/StatusTrack";
import { Timeline, type TimelineItem } from "@smw/ui/finance/Timeline";
import { EmptyLine } from "@smw/ui/finance/States";
import { Button } from "@smw/ui/ui/button";
import { dateTime, shortDate } from "@smw/ui/format";
import { EnquiryService, OPEN_STAGES, STAGE_ORDER, STAGE_WORDS, istDay, istStart, stageRank } from "../service";
import { addNote, addTask, assignEnquiry, bookVisit, claimEnquiry, deleteEnquiry, doneTask, emailEnquiry, logCall, mergeEnquiries, moveEnquiry, postponeTask, recordVisit, updateEnquiry, whatsappEnquiry } from "./enquiry-actions";
import { callFields, doneFields, KIND_WORDS, moveFields, noteFields, personFields, STAGE_TONES, taskFields, visitFields, visitedFields } from "./enquiry-fields";
import { EnquiryMessage } from "./enquiry-message";

export const metadata = { title: "Enquiry" };
const tel = (p: string) => `tel:+91${p.replace(/\D/g, "").replace(/^0/, "")}`;
const EVENT_TONE: Record<string, TimelineItem["tone"]> = { stage: "info", admitted: "success", call: "default", visit: "info", merged: "warning", again: "warning" };

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const svc = new EnquiryService(ctx);
  if (!svc.can("enquiries")) return <NoAccess title="Enquiries are handled by the office." hint="Ask your school admin if you need them." />;
  const { id } = await params;
  const d = await svc.detail(id).catch((e: unknown) => (e instanceof NotFoundError ? notFound() : Promise.reject(e)));
  const [opts] = await Promise.all([svc.options()]);
  const { enquiry: e, owner, events, tasks, duplicates, siblings, seats, student, settings, linkDead, siblingCount } = d;
  const pipeline = svc.can("pipeline");
  const live = !d.mergedInto;
  const open = OPEN_STAGES.includes(e.status);
  const people = opts.people.map((p) => ({ value: p.id, label: p.name }));
  const tomorrow = `${istDay(new Date(istStart(istDay(new Date())).getTime() + 36 * 3_600_000))}T10:00`;
  const hidden = { id: e.id };

  const modal = (title: string, fields: Parameters<typeof FormModal>[0]["fields"], action: Parameters<typeof FormModal>[0]["action"], trigger: NonNullable<Parameters<typeof FormModal>[0]["trigger"]>, values?: Record<string, unknown>) =>
    <FormModal title={title} icon="inbox" fields={fields} action={action} hidden={hidden} trigger={trigger} values={values} />;

  // The one main step of each stage.
  let primary: ReactNode = null;
  if (live) {
    if (e.status === "closed") primary = <ActionButton variant="default" label="Open again" action={moveEnquiry} values={{ id: e.id, to: "contacted" }} successMessage="Opened again" />;
    else if (e.status === "admitted") primary = linkDead ? <Button asChild className="rounded-full"><Link href={`/app/enquiries/${e.id}/admit`}>Admit again</Link></Button> : student ? <Button asChild className="rounded-full"><Link href={`/app/students/${student.id}`}>Open the student</Link></Button> : null;
    else if (e.status === "new") primary = <Button asChild className="rounded-full"><a href={tel(e.phone)}>Call now</a></Button>;
    else if (e.kind === "question") primary = <FormModal title="Close this question" icon="inbox" fields={moveFields(d.closeReasons).slice(1)} action={moveEnquiry} hidden={{ id: e.id, to: "closed" }} trigger={{ label: "Close the question" }} />;
    else if (e.status === "contacted") primary = modal("Book a visit", visitFields, bookVisit, { label: "Book visit" });
    else if (e.status === "visit") primary = modal("Record the visit", visitedFields, recordVisit, { label: "Record visit" });
    else if (e.status === "visited") primary = <ActionButton variant="default" label="Mark applied" action={moveEnquiry} values={{ id: e.id, to: "applied" }} successMessage="Marked applied" />;
    else if (e.status === "applied" || e.status === "waitlist") primary = <ActionButton variant="default" label="Make offer" action={moveEnquiry} values={{ id: e.id, to: "offered" }} successMessage="Offer made" />;
    else if (e.status === "offered") primary = <Button asChild className="rounded-full"><Link href={`/app/enquiries/${e.id}/admit`}>Admit</Link></Button>;
  }

  const rank = stageRank(e.status);
  const reachedRank = stageRank(e.reached);
  const track: TrackStep[] = STAGE_ORDER.filter((s) => e.kind === "admission" || s === "new" || s === "contacted").map((s, i) => ({
    label: STAGE_WORDS[s], state: e.status === s ? "now" : (rank >= 0 ? i < rank : i <= reachedRank) ? "done" : "todo",
  }));
  const items: TimelineItem[] = events.map((ev) => ({ at: ev.createdAt.toISOString(), title: ev.body ?? ev.kind, meta: ev.byName, tone: EVENT_TONE[ev.kind] }));
  const openTasks = tasks.filter((t) => !t.doneAt), doneTasks = tasks.filter((t) => t.doneAt).slice(0, 3);
  const wa = settings.templates.filter((t) => t.channel === "whatsapp"), em = settings.templates.filter((t) => t.channel === "email");

  return (
    <div className="flex flex-col gap-6">
      <EntityHeader back={{ href: "/app/enquiries", label: "Enquiries" }} title={e.studentName}
        chips={<><ToneBadge label={STAGE_WORDS[e.status]} tone={STAGE_TONES[e.status]} />{e.kind === "question" ? <ToneBadge label="Question" /> : null}{e.priority ? <ToneBadge label="Priority" tone="warning" /> : null}{e.status === "waitlist" || e.status === "closed" ? <ToneBadge label={`Reached: ${STAGE_WORDS[e.reached]}`} /> : null}</>}
        meta={[e.ref, e.parentName, e.classApplying, e.session, owner ? `Owner: ${owner.name}` : "No owner"]}
        actions={live ? <>{primary}
          {open ? modal("Log a call", callFields, logCall, { label: "Log call", variant: "secondary" }) : null}
          <MoreMenu>
            {modal("Change this enquiry", personFields({ classes: opts.classes, sources: settings.sources, sessions: opts.sessions, mode: "edit" }), updateEnquiry, { label: "Edit details", variant: "ghost" }, { ...e, tags: e.tags.join(", "), priority: e.priority })}
            {modal("Write a note", noteFields, addNote, { label: "Add a note", variant: "ghost" })}
            {e.status !== "admitted" || linkDead ? modal("Move to a stage", moveFields(d.closeReasons), moveEnquiry, { label: "Move to a stage…", variant: "ghost" }, { to: e.status === "closed" ? "contacted" : undefined }) : null}
            {!e.ownerId ? <ActionButton variant="ghost" label="Take this enquiry" action={claimEnquiry} values={{ id: e.id }} successMessage="You have it" /> : null}
            {pipeline ? modal("Give this enquiry to someone", [{ name: "ownerId", label: "Who", type: "select", options: people, hint: "Left empty: nobody." }], assignEnquiry, { label: "Give to…", variant: "ghost" }, { ownerId: e.ownerId ?? undefined }) : null}
            {pipeline && (e.status !== "admitted" || linkDead) ? <ActionButton variant="ghost" label="Delete" action={deleteEnquiry} values={{ id: e.id }} redirectTo="/app/enquiries"
              confirm={{ title: "Delete this enquiry?", body: `${e.studentName}'s enquiry and its whole timeline will be removed. This cannot be undone. Close it instead if you want to keep the history.`, confirmLabel: "Delete", danger: true }} /> : null}
            <MenuLink href="/app/enquiries/reports">Reports</MenuLink>
          </MoreMenu></> : null} />

      {d.mergedInto ? (
        <Inset className="flex flex-wrap items-center gap-3"><p className="text-sm">This enquiry was joined to <Link className="underline" href={`/app/enquiries/${d.mergedInto.id}`}>{d.mergedInto.ref}</Link>. Everything on it moved there.</p></Inset>
      ) : null}
      {live && linkDead ? (
        <Inset className="flex flex-wrap items-center gap-3"><ToneBadge label="Student deleted" tone="warning" /><p className="min-w-0 flex-1 text-sm text-[var(--ds-on-surface-variant)]">The student record was deleted. This enquiry still says admitted.</p>
          <Button asChild className="rounded-full"><Link href={`/app/enquiries/${e.id}/admit`}>Admit again</Link></Button>
          <Button asChild variant="secondary" className="rounded-full"><Link href={`/app/enquiries/${e.id}/admit#link`}>Link to a student</Link></Button>
          <ActionButton variant="secondary" label="Reopen" action={moveEnquiry} values={{ id: e.id, to: "contacted" }} successMessage="Opened again" /></Inset>
      ) : null}
      {live && e.status !== "waitlist" && e.status !== "closed" ? <Panel><StatusTrack label="Stage" steps={track} /></Panel> : null}
      {live && d.noNextStep ? (
        <Inset className="flex flex-wrap items-center gap-3"><ToneBadge label="No next step" tone="warning" /><p className="min-w-0 flex-1 text-sm text-[var(--ds-on-surface-variant)]">Nobody is due to do anything on this enquiry. Add a next step, or close it.</p>
          {modal("Add a next step", taskFields(people), addTask, { label: "Add a next step", variant: "secondary" }, { kind: "call", dueAt: tomorrow })}</Inset>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="flex flex-col gap-3 lg:col-span-7">
          <Panel title="Timeline" action={live ? modal("Write a note", noteFields, addNote, { label: "Note", variant: "ghost", size: "sm", plus: true }) : undefined}>
            {items.length ? <Timeline items={items} /> : <EmptyLine title="Nothing has happened yet." />}
          </Panel>
        </div>
        <div className="flex flex-col gap-3 lg:col-span-5">
          <Panel title="Next steps" action={live && open ? modal("Add a next step", taskFields(people), addTask, { label: "Add", variant: "ghost", size: "sm", plus: true }, { kind: "call", dueAt: tomorrow }) : undefined}>
            {!openTasks.length && !doneTasks.length ? <p className="text-sm text-[var(--ds-on-surface-muted)]">{open ? "Nothing planned." : "Nothing more to do."}</p> : null}
            <ul className="flex flex-col divide-y divide-white/[0.06]">
              {openTasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 basis-40"><span className="block text-sm">{t.title ?? KIND_WORDS[t.kind]}</span>
                    <span className={`block text-xs ${t.dueAt < new Date() ? "text-[var(--ds-color-danger-400)]" : "text-[var(--ds-on-surface-muted)]"}`}>{dateTime(t.dueAt)}{t.ownerName ? ` · ${t.ownerName}` : ""}</span></span>
                  {live ? <><FormModal title={`Done: ${t.title ?? KIND_WORDS[t.kind]}`} icon="inbox" fields={doneFields(d.closeReasons)} action={doneTask} hidden={{ id: t.id }} values={{ outcome: "Done", nextKind: "call" }} trigger={{ label: "Done", variant: "ghost", size: "sm" }} />
                    <ActionButton variant="ghost" label="Tomorrow" action={postponeTask} values={{ id: t.id, dueAt: tomorrow }} successMessage="Moved to tomorrow" /></> : null}
                </li>))}
              {doneTasks.map((t) => (<li key={t.id} className="py-2 text-xs text-[var(--ds-on-surface-muted)]">Done: {t.title ?? KIND_WORDS[t.kind]}{t.outcome ? `. ${t.outcome}` : ""}</li>))}
            </ul>
          </Panel>

          <Panel title="Family" action={live ? <span className="flex flex-wrap items-center gap-1.5"><Button asChild variant="secondary" className="rounded-full"><a href={tel(e.phone)}>Call</a></Button>
            <EnquiryMessage id={e.id} channel="whatsapp" templates={wa} action={whatsappEnquiry} />
            <EnquiryMessage id={e.id} channel="email" templates={em} action={emailEnquiry} disabledReason={e.email ? undefined : "Add an email first (Edit details)"} /></span> : undefined}>
            <FactList>
              <Fact label="Parent">{e.parentName}{e.relation ? ` (${e.relation})` : ""}</Fact>
              <Fact label="Phone" copy={e.phone}>{e.phone}</Fact>
              <Fact label="Second phone" copy={e.altPhone ?? undefined}>{e.altPhone}</Fact>
              <Fact label="Email" copy={e.email ?? undefined}>{e.email}</Fact>
              <Fact label="Address" wrap>{e.address}</Fact>
            </FactList>
          </Panel>

          <Panel title="Child">
            <FactList>
              <Fact label="Class">{e.classApplying}</Fact><Fact label="Session">{e.session}</Fact>
              <Fact label="Born">{e.dob ? shortDate(e.dob) : null}</Fact><Fact label="Gender">{e.gender}</Fact><Fact label="Previous school">{e.previousSchool}</Fact>
              <Fact label="Message" wrap>{e.message}</Fact>
              {seats ? <Fact label="Seats left" wrap>{seats.left > 0 ? `${seats.left} of ${seats.seats} in ${seats.className} for ${seats.session}` : `None left in ${seats.className}: ${seats.taken} of ${seats.seats} are offered or admitted`}</Fact> : null}
            </FactList>
          </Panel>

          <Panel title="Where they came from">
            <FactList>
              <Fact label="Source">{e.source}</Fact><Fact label="Campaign">{e.campaign}</Fact><Fact label="Received">{dateTime(e.createdAt)}</Fact>
              <Fact label="Consent" wrap>{e.consentAt ? `Given ${dateTime(e.consentAt)}` : e.source === "website" ? "Not recorded" : "Taken by the office"}</Fact>
              <Fact label="First call">{e.firstContactAt ? dateTime(e.firstContactAt) : "Not yet"}</Fact>
            </FactList>
          </Panel>

          {duplicates.length || siblingCount || student ? (
            <Panel title="Same family?">
              <ul className="flex flex-col gap-2 text-sm">
                {student ? <li>Admitted as <Link className="underline" href={`/app/students/${student.id}`}>{student.name}</Link> ({student.admissionNo}).</li> : null}
                {!siblings.length && siblingCount ? <li>This phone belongs to a current family.</li> : null}
                {siblings.length ? <li>This phone belongs to the family of {siblings.map((s, i) => <span key={s.id}>{i ? ", " : ""}<Link className="underline" href={`/app/students/${s.id}`}>{s.name}</Link>{s.classSection ? `, ${s.classSection}` : ""}</span>)}.</li> : null}
                {duplicates.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 basis-40">{duplicates.length === 1 ? "Another enquiry from this phone: " : ""}<Link className="underline" href={`/app/enquiries/${x.id}`}>{x.ref}</Link> {x.studentName}, {STAGE_WORDS[x.status]}</span>
                    {pipeline && live ? <ActionButton variant="ghost" label="Join" action={mergeEnquiries} values={{ keepId: e.id, otherId: x.id }}
                      confirm={{ title: "Join these two enquiries?", body: `The older reference stays and takes the timeline and next steps of the other. This cannot be undone.`, confirmLabel: "Join them" }} /> : null}</li>))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
