"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal, ModalField, ModalFooter, ModalSection } from "@smw/ui/kit/Modal";
import { FilesField } from "@smw/ui/comm/FilesField";
import type { FileItem } from "@smw/ui/comm/FileList";
import { INPUT, keepValues } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { cn } from "@smw/ui/utils";
import type { AudienceOptions } from "@smw/feature-notifications/audience";
import { isEveryone, type Audience } from "@smw/feature-notifications/audience-rules";
import { AudiencePicker } from "@smw/feature-notifications/ui/audience-picker";
import { EVENT_TYPES, REMINDER_CHOICES, REPEATS, type EventType, type RepeatKind, type Scope } from "../constants";
import { createEvent, updateEvent } from "./actions";
import { ScopeChoice } from "./scope-choice";
import { MUTED, PILL, PRIMARY } from "./styles";

export interface FormInitial {
  title: string; type: EventType; description: string; allDay: boolean; startsAt: string; endsAt: string; location: string; mapUrl: string; bring: string;
  audience: Audience; isPublic: boolean; reminders: number[]; rsvpOn: boolean; capacity: string; guests: string; closesAt: string; consentHref: string;
}
export interface EventFormProps {
  mode: "create" | "edit"; eventId?: string; isDraft?: boolean; options: AudienceOptions; initial: FormInitial; labels?: Record<string, string>;
  files?: FileItem[]; seriesTotal?: number; canWebsite: boolean; cancelHref: string;
}

const RULES = ["everyone", "families", "staff", "class", "section", "house", "route", "stop", "subject", "role", "group", "student", "person", "teachers_of"] as const;
const dayOf = (v: string) => v.slice(0, 10);
const addHour = (v: string) => { const d = new Date(`${v}:00Z`); d.setUTCHours(d.getUTCHours() + 1); return d.toISOString().slice(0, 16); };

/** One form for adding and changing an event. Everything has a default, so the short path is a title, a time and who it is for. */
export function EventForm({ mode, eventId, isDraft, options, initial, labels, files = [], seriesTotal, canWebsite, cancelHref }: EventFormProps) {
  const uid = useId();
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [type, setType] = useState(initial.type);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [endsAt, setEndsAt] = useState(initial.endsAt);
  const [audience, setAudience] = useState(initial.audience);
  const [repeat, setRepeat] = useState<RepeatKind>("none");
  const [rsvpOn, setRsvpOn] = useState(initial.rsvpOn);
  const [notify, setNotify] = useState(true);
  const [scopeFor, setScopeFor] = useState<FormData | null>(null);
  const [scope, setScope] = useState<Scope>("this");
  const id = (n: string) => `${uid}-${n}`;
  const err = (n: string) => errors[n];

  const send = (fd: FormData, chosen: Scope) => start(async () => {
    if (eventId) { fd.set("id", eventId); fd.set("scope", chosen); }
    const r = await (mode === "create" ? createEvent(fd) : updateEvent(fd));
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); setBanner(r.error); toast(r.error, "danger"); return; }
    const data = r.data as { id: string; warning: string | null };
    toast(data.warning ? `Saved, but the files were not: ${data.warning}` : r.message ?? "Saved", data.warning ? "danger" : "default");
    router.push(`/app/events/${data.id}`);
  });
  const submit = keepValues((fd) => {
    setErrors({}); setBanner(null);
    if (mode === "edit" && seriesTotal && seriesTotal > 1) { setScopeFor(fd); return; }
    send(fd, "this");
  });

  const flip = (on: boolean) => {
    setAllDay(on);
    setStartsAt((v) => (on ? dayOf(v) : `${dayOf(v)}T10:00`));
    setEndsAt((v) => (v ? (on ? dayOf(v) : `${dayOf(v)}T11:00`) : v));
  };
  const onStart = (v: string) => { setStartsAt(v); if (v && (!endsAt || endsAt < v) && !allDay) setEndsAt(addHour(v)); };
  const field = (name: string, label: string, control: React.ReactNode, o: { hint?: React.ReactNode; className?: string; required?: boolean } = {}) =>
    <ModalField label={label} htmlFor={id(name)} error={err(name)} hint={o.hint} className={o.className} required={o.required}>{control}</ModalField>;
  const check = (name: string, text: string, state: [boolean, (b: boolean) => void] | null, def = false) => (
    <label className="flex min-h-10 items-center gap-2 text-sm">
      <input type="checkbox" name={name} value="true" {...(state ? { checked: state[0], onChange: (e) => state[1](e.target.checked) } : { defaultChecked: def })} className="h-4 w-4 accent-[var(--ds-primary)]" />{text}
    </label>
  );
  const when = allDay ? "date" : "datetime-local";

  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-8">
      {banner ? <p role="alert" className="rounded-2xl bg-[var(--ds-color-danger-500)]/15 px-4 py-3 text-sm text-[var(--ds-color-danger-300)]">{banner}</p> : null}

      <ModalSection title="What">
        {field("title", "Title", <input id={id("title")} name="title" defaultValue={initial.title} required maxLength={160} autoComplete="off" className={INPUT} aria-invalid={!!err("title") || undefined} />, { required: true })}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("type", "Kind of event", <select id={id("type")} name="type" value={type} onChange={(e) => setType(e.target.value as EventType)} className={INPUT}>{Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>, { hint: "The colour on the calendar comes from this." })}
          {type === "trip" ? field("consentHref", "Consent notice (optional)", <input id={id("consentHref")} name="consentHref" defaultValue={initial.consentHref} placeholder="/app/announcements/..." className={INPUT} />, { hint: "Paste the link of the notice that asks families for consent." }) : null}
        </div>
        {field("description", "Details", <textarea id={id("description")} name="description" defaultValue={initial.description} rows={4} maxLength={4000} className={cn(INPUT, "h-auto py-2")} />, { hint: "Plain words. **bold**, lists and links work." })}
      </ModalSection>

      <ModalSection title="When">
        {check("allDay", "All day (no time)", [allDay, flip])}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("startsAt", allDay ? "First day" : "Starts", <input id={id("startsAt")} name="startsAt" type={when} value={startsAt} onChange={(e) => onStart(e.target.value)} required className={INPUT} />, { required: true })}
          {field("endsAt", allDay ? "Last day (optional)" : "Ends (optional)", <input id={id("endsAt")} name="endsAt" type={when} value={endsAt} min={startsAt} onChange={(e) => setEndsAt(e.target.value)} className={INPUT} />)}
        </div>
        {mode === "create" ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-4 sm:grid-cols-2">
              {field("repeat", "Repeat", <select id={id("repeat")} name="repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatKind)} className={INPUT}>{Object.entries(REPEATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>)}
              {repeat !== "none" ? field("repeatUntil", "Until", <input id={id("repeatUntil")} name="repeatUntil" type="date" min={dayOf(startsAt)} required className={INPUT} />, { hint: "Up to 60 dates.", required: true }) : null}
            </div>
            {repeat !== "none" ? check("skipClosed", "Skip days the school is closed (Sundays and holidays)", null) : null}
          </div>
        ) : seriesTotal && seriesTotal > 1 ? <p className={MUTED}>This is one of {seriesTotal} dates. You will choose which ones to change when you save.</p> : null}
      </ModalSection>

      <ModalSection title="Where">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("location", "Place", <input id={id("location")} name="location" defaultValue={initial.location} maxLength={160} className={INPUT} />)}
          {field("mapUrl", "Map link (optional)", <input id={id("mapUrl")} name="mapUrl" type="url" defaultValue={initial.mapUrl} placeholder="https://maps.google.com/..." className={INPUT} />)}
        </div>
      </ModalSection>

      <ModalSection title="Who is it for">
        <div>
          <AudiencePicker name="audience" value={audience} onChange={setAudience} options={{ ...options, canFeeOverdue: false }} allow={[...RULES]} labels={labels} />
          {err("audience") ? <p role="alert" className="mt-1 text-xs text-[var(--ds-color-danger-400)]">{err("audience")}</p> : null}
        </div>
        {canWebsite && isEveryone(audience) ? check("isPublic", "Show on the school website", null, initial.isPublic) : null}
        {mode === "create" ? <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />Tell them now (a message on their phone and in the app)</label> : null}
        <input type="hidden" name="notify" value={mode === "create" && !notify ? "false" : "true"} />
      </ModalSection>

      <ModalSection title="Answers">
        {check("rsvpOn", "Ask people to answer: yes, maybe or no", [rsvpOn, setRsvpOn])}
        {rsvpOn ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {field("capacity", "Places (optional)", <input id={id("capacity")} name="capacity" type="number" min={1} defaultValue={initial.capacity} className={INPUT} />, { hint: "When full, others join a waiting list." })}
            {field("guests", "Guests each (optional)", <input id={id("guests")} name="guests" type="number" min={0} max={10} defaultValue={initial.guests} className={INPUT} />)}
            {field("closesAt", "Answers close (optional)", <input id={id("closesAt")} name="closesAt" type="datetime-local" defaultValue={initial.closesAt} className={INPUT} />)}
          </div>
        ) : null}
      </ModalSection>

      <ModalSection title="Reminders" description="Sent once, to everyone who has not said no.">
        <input type="hidden" name="reminders" value="0" />
        <div className="flex flex-wrap gap-2">
          {REMINDER_CHOICES.map((c) => (
            <label key={c.minutes} className="flex min-h-10 items-center gap-2 rounded-full bg-white/[0.05] px-4 text-sm has-[:checked]:bg-[var(--ds-color-primary-500)]/20">
              <input type="checkbox" name="reminders" value={c.minutes} defaultChecked={initial.reminders.includes(c.minutes)} className="h-4 w-4 accent-[var(--ds-primary)]" />{c.label}
            </label>
          ))}
        </div>
      </ModalSection>

      <ModalSection title="More">
        {field("bring", "What to bring (optional)", <textarea id={id("bring")} name="bring" defaultValue={initial.bring} rows={2} maxLength={500} className={cn(INPUT, "h-auto py-2")} />)}
        <FilesField existing={files} maxCount={5} />
        {err("files") ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{err("files")}</p> : null}
      </ModalSection>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-6">
        <button type="submit" disabled={pending} className={PRIMARY}>{pending ? "Saving" : mode === "create" ? "Publish event" : isDraft ? "Save draft" : "Save changes"}</button>
        {mode === "create" ? <button type="submit" name="draft" value="true" disabled={pending} className={PILL}>Save as draft</button> : null}
        <Link href={cancelHref} className={PILL}>Cancel</Link>
        <p className={cn(MUTED, "basis-full sm:ml-2 sm:basis-auto")}>{mode === "create" ? (notify ? "Everyone it is for gets a message." : "Nobody gets a message now. It shows on their calendar.") : isDraft ? "Nobody has been told yet." : "People are told only if the time, the place or who it is for changes."}</p>
      </div>

      <Modal open={!!scopeFor} onOpenChange={(o) => !o && setScopeFor(null)} size="sm" title="Change which events?" description={`This is one of ${seriesTotal} dates.`}
        footer={<ModalFooter secondary={{ label: "Back", onClick: () => setScopeFor(null) }} primary={{ label: "Save", loading: pending, onClick: () => { const fd = scopeFor!; setScopeFor(null); send(fd, scope); } }} />}>
        <div className="pt-2"><ScopeChoice value={scope} onChange={setScope} /><p className={cn(MUTED, "pt-3")}>A cancelled date stays cancelled.</p></div>
      </Modal>
    </form>
  );
}
