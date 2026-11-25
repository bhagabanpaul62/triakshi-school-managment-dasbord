import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { refusalOr } from "@smw/runtime/refusal";
import { NotFoundError } from "@smw/feature-kit";
import { AudienceService } from "@smw/feature-notifications/audience";
import { EVERYONE } from "@smw/feature-notifications/audience-rules";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DEFAULT_REMINDERS } from "../constants";
import { addDays, istDay, toInputValue } from "../dates";
import { EventService } from "../service";
import { EventForm, type FormInitial } from "./event-form";

/** New event (no id) or change an event. Defaults: tomorrow at 10:00 for an hour, for the author's own sections (or everyone, for the office). */
async function EventFormPage({ params }: { params?: Promise<{ id: string }> }) {
  const id = params ? (await params).id : undefined;
  const ctx = await requireCtx();
  const svc = new EventService(ctx);
  if (!svc.can("write")) redirect("/app/events");
  const options = await new AudienceService(ctx).options();
  const manage = svc.can("manage");
  const writers = await svc.owners();

  if (!id) {
    const day = addDays(istDay(new Date()), 1);
    const mine = options.classTeacherSections.map((s) => ({ type: "section" as const, id: s }));
    const initial: FormInitial = {
      title: "", type: "event", description: "", allDay: false, startsAt: `${day}T10:00`, endsAt: `${day}T11:00`, location: "", mapUrl: "", bring: "", isPublic: false, reminders: DEFAULT_REMINDERS,
      audience: !manage && mine.length ? { include: mine, exclude: [] } : manage ? EVERYONE : { include: [], exclude: [] }, rsvpOn: false, capacity: "", guests: "", closesAt: "", consentHref: "", ownerId: ctx.userId,
    };
    return (<><PageHeader eyebrow="Calendar" title="Add event" description="Put it on the calendar of the people it is for." /><EventForm mode="create" owners={writers} options={options} initial={initial} canWebsite={manage} cancelHref="/app/events" /></>);
  }

  const d = await svc.detail(id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  if (!d.canRun) redirect(`/app/events/${id}`);
  const e = d.event;
  // An owner who can no longer add events stays selectable, so saving never moves the event by accident.
  const owners = !e.ownerId || writers.some((w) => w.id === e.ownerId) ? writers : [{ id: e.ownerId, name: d.owner ?? "Current owner" }, ...writers];
  if (e.state === "cancelled") redirect(`/app/events/${id}`);
  const initial: FormInitial = {
    title: e.title, type: e.type, description: e.description ?? "", allDay: e.allDay, startsAt: e.allDay ? toInputValue(e.startsAt).slice(0, 10) : toInputValue(e.startsAt),
    endsAt: e.endsAt ? (e.allDay ? toInputValue(e.endsAt).slice(0, 10) : toInputValue(e.endsAt)) : "", location: e.location ?? "", mapUrl: e.mapUrl ?? "", bring: e.bring ?? "",
    audience: e.audience, isPublic: e.isPublic, reminders: e.reminders, rsvpOn: e.rsvp.on, capacity: e.rsvp.capacity ? String(e.rsvp.capacity) : "", guests: e.rsvp.guests ? String(e.rsvp.guests) : "",
    closesAt: e.rsvp.closesAt ? toInputValue(e.rsvp.closesAt) : "", consentHref: e.consentHref ?? "", ownerId: e.ownerId ?? "",
  };
  return (
    <>
      <PageHeader eyebrow="Calendar" title={e.state === "draft" ? "Change draft" : "Change event"} description={e.title} />
      <EventForm mode="edit" owners={owners} eventId={id} isDraft={e.state === "draft"} options={options} initial={initial} canWebsite={manage} seriesTotal={d.series?.total} cancelHref={`/app/events/${id}`}
        labels={await svc.chipNames(e.audience)} files={d.files.map((f) => ({ id: f.id, name: f.fileName, sizeBytes: f.size, type: f.contentType, href: `/api/calendar/files/${f.id}` }))} />
    </>
  );
}

export default function Page(props: Parameters<typeof EventFormPage>[0]) { return refusalOr(() => EventFormPage(props)); }
