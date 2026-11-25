import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { requireCtx } from "@smw/runtime";
import { NotFoundError } from "@smw/feature-kit";
import { isEveryone } from "@smw/feature-notifications/audience-rules";
import { Markdown } from "@smw/ui/comm/Markdown";
import { FileList } from "@smw/ui/comm/FileList";
import { ResponseFunnel } from "@smw/ui/comm/ResponseFunnel";
import { StateChip } from "@smw/ui/comm/StateChip";
import { Panel } from "@smw/ui/kit/Panel";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { TONE } from "@smw/ui/tone";
import { cn } from "@smw/ui/utils";
import { EVENT_TYPES, TYPE_TONE } from "../constants";
import { istDay } from "../dates";
import { RsvpService } from "../rsvp";
import { EventService } from "../service";
import { EventActions } from "./event-actions";
import { RsvpBar } from "./rsvp-bar";
import { RsvpList } from "./rsvp-list";
import { LINK, MUTED } from "./styles";
import { whenLabel } from "./when";

export const metadata = { title: "Event" };

function stateOf(e: { state: string; startsAt: Date; endsAt: Date | null }) {
  if (e.state !== "live") return e.state;
  const now = new Date(), end = e.endsAt ?? e.startsAt;
  if (end < now) return "done";
  if (e.startsAt <= now) return "ongoing";
  return istDay(e.startsAt) === istDay(now) ? "today" : "upcoming";
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const svc = new EventService(ctx);
  const d = await svc.detail(id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const { event: e, me, counts, series, files } = d;
  const view = { startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null, allDay: e.allDay };
  const list = d.canRun && e.rsvp.on && !ctx.supportStaffId ? await new RsvpService(ctx).list(id) : null;
  const over = (e.endsAt ?? e.startsAt) < new Date();
  const closed = e.rsvp.closesAt && new Date(e.rsvp.closesAt) <= new Date() ? "Answers for this event are closed." : over ? "This event is over." : undefined;
  const invited = !!me || (e.state === "live" && isEveryone(e.audience) && !ctx.supportStaffId);
  const askAnswer = e.rsvp.on && e.state === "live" && invited;
  const dot = TONE[TYPE_TONE[e.type]].dot;

  return (
    <>
      <div className="flex flex-col gap-4 pb-6 pt-2">
        <Link href="/app/events" className={cn("inline-flex min-h-10 items-center gap-1 self-start text-sm text-[var(--ds-on-surface-variant)]", LINK)}><IconArrowLeft className="h-4 w-4" aria-hidden />Calendar</Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]"><span aria-hidden className={cn("h-2 w-2 rounded-full", dot)} />{EVENT_TYPES[e.type]}</p>
            <h1 className={cn("mt-1 text-[28px] font-medium tracking-tight text-[var(--ds-on-surface)]", e.state === "cancelled" && "line-through opacity-70")}>{e.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2"><StateChip kind="event" state={stateOf(e)} />{e.isPublic ? <span className={MUTED}>On the school website</span> : null}</div>
          </div>
          <EventActions id={e.id} state={e.state} inSeries={!!series} canRun={d.canRun} />
        </div>
        {e.state === "cancelled" ? <p role="status" className="rounded-2xl bg-[var(--ds-color-danger-500)]/15 px-4 py-3 text-sm text-[var(--ds-color-danger-300)]">This event is cancelled{e.cancelReason ? `: ${e.cancelReason}` : "."}</p> : null}
        {e.state === "draft" ? <p role="status" className="rounded-2xl bg-white/[0.06] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]">This is a draft. Only you and the office can see it. Publish it when it is ready, and people will be told.</p> : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
          {askAnswer ? <RsvpBar eventId={e.id} answer={me?.answer ?? null} waiting={!!me?.waitingSince} guests={me?.guests ?? 0} maxGuests={e.rsvp.guests ?? 0} closedReason={closed} /> : null}
          {e.description || e.bring || files.length ? (
            <Panel title="About this event">
              <div className="flex flex-col gap-4">
                {e.description ? <Markdown source={e.description} /> : null}
                {e.bring ? <div><h3 className={cn(MUTED, "pb-1")}>What to bring</h3><Markdown source={e.bring} /></div> : null}
                {files.length ? <FileList files={files.map((f) => ({ id: f.id, name: f.fileName, sizeBytes: f.size, type: f.contentType, href: `/api/calendar/files/${f.id}` }))} /> : null}
              </div>
            </Panel>
          ) : null}
          {list && counts ? (
            <Panel title="Who is coming">
              <div className="flex flex-col gap-5">
                <ResponseFunnel progress={{ done: counts.invited - counts.noReply, total: counts.invited }}
                  parts={[{ label: "Going", value: counts.going, tone: "success" }, { label: "Maybe", value: counts.maybe, tone: "warning" }, { label: "Not going", value: counts.no }, { label: "Waiting list", value: counts.waiting, tone: "info" }, { label: "No answer", value: counts.noReply }]} />
                <p className="text-sm text-[var(--ds-on-surface-variant)]">{counts.seats}{e.rsvp.capacity ? ` of ${e.rsvp.capacity}` : ""} places taken{counts.guests ? `, ${counts.guests} guests included` : ""}{counts.checkedIn ? `. ${counts.checkedIn} arrived.` : "."}</p>
                <RsvpList eventId={e.id} csvHref={`/api/calendar/events/${e.id}/answers.csv`} live={e.state === "live"}
                  rows={list.rows.map((p) => ({ key: p.personKey, name: p.name, label: p.label, answer: p.answer, guests: p.guests, waiting: !!p.waitingSince, checkedIn: !!p.checkedInAt }))} />
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
          <Panel title="Details">
            <FactList>
              <Fact label="When">{whenLabel(view)}</Fact>
              <Fact label="Where">{e.location ? <span>{e.location}{e.mapUrl ? <> · <a href={e.mapUrl} target="_blank" rel="noopener noreferrer" className={LINK}>Open map</a></> : null}</span> : e.mapUrl ? <a href={e.mapUrl} target="_blank" rel="noopener noreferrer" className={LINK}>Open map</a> : null}</Fact>
              <Fact label="Who it is for">{e.audienceLabel || null}</Fact>
              <Fact label="Added by">{d.owner}</Fact>
              {e.rsvp.on ? <Fact label="Answers">{[e.rsvp.capacity ? `${e.rsvp.capacity} places` : "No limit", e.rsvp.guests ? `up to ${e.rsvp.guests} guests each` : null, e.rsvp.closesAt ? `close ${whenLabel({ startsAt: e.rsvp.closesAt, endsAt: null, allDay: false })}` : null].filter(Boolean).join(", ")}</Fact> : null}
              {e.type === "trip" ? <Fact label="Consent">{e.consentHref ? <Link href={e.consentHref} className={LINK}>Open the consent notice</Link> : d.canRun ? <span className={MUTED}>No consent notice linked. <Link href={`/app/events/${e.id}/edit`} className={LINK}>Add one</Link></span> : null}</Fact> : null}
              {series ? <Fact label="Series">{series.number} of {series.total}{series.previous ? <> · <Link href={`/app/events/${series.previous}`} className={LINK}>Earlier</Link></> : null}{series.next ? <> · <Link href={`/app/events/${series.next}`} className={LINK}>Next</Link></> : null}</Fact> : null}
            </FactList>
          </Panel>
        </div>
      </div>
    </>
  );
}
