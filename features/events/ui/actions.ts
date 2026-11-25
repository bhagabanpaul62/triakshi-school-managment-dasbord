"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { feedPath, CalendarFeedService } from "../feed";
import type { UploadedFile } from "../files";
import { RsvpService } from "../rsvp";
import { EventService } from "../service";
import type { Scope } from "../constants";

/** Files from a form field as plain values: `File` never reaches a service. */
async function uploadsFrom(fd: FormData, field: string): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  for (const v of fd.getAll(field)) if (v instanceof File && v.size > 0) out.push({ name: v.name, type: v.type, size: v.size, bytes: new Uint8Array(await v.arrayBuffer()) });
  return out;
}
const scopeOf = (fd: FormData) => String(fd.get("scope") ?? "this") as Scope;
const id = (fd: FormData) => String(fd.get("id"));

/** The event is saved first; a file that is refused afterwards is reported, not retried into a second event. */
async function files(s: EventService, eventId: string, fd: FormData, scope: Scope) {
  try {
    await s.detach(eventId, fd.getAll("removeIds").map(String), scope);
    await s.attach(eventId, await uploadsFrom(fd, "files"), scope);
    return null;
  } catch (e) { return e instanceof Error ? e.message : "The files could not be saved."; }
}

export async function createEvent(fd: FormData) {
  return serviceAction(EventService, async (s) => {
    const row = await s.create(formToObject(fd));
    return { id: row.id, warning: await files(s, row.id, fd, "all") };
  }, "Event saved");
}
export async function updateEvent(fd: FormData) {
  return serviceAction(EventService, async (s) => {
    const scope = scopeOf(fd);
    const row = await s.update(id(fd), formToObject(fd), scope);
    return { id: row.id, warning: await files(s, row.id, fd, scope) };
  }, "Event updated");
}
export async function cancelEvent(fd: FormData) {
  return serviceAction(EventService, (s) => s.cancel(id(fd), { reason: fd.get("reason"), scope: scopeOf(fd) }), "Event cancelled. People have been told.");
}
export async function deleteEvent(fd: FormData) {
  return serviceAction(EventService, (s) => s.remove(id(fd), scopeOf(fd)), "Draft deleted");
}
export async function publishEvent(fd: FormData) {
  return serviceAction(EventService, (s) => s.publish(id(fd), fd.get("notify") !== "false"), "Published");
}

export async function answerEvent(fd: FormData) {
  return serviceAction(RsvpService, (s) => s.answer(id(fd), { answer: fd.get("answer"), guests: fd.get("guests") ?? 0 }));
}
export async function answerForPerson(fd: FormData) {
  return serviceAction(RsvpService, (s) => s.answerFor(id(fd), String(fd.get("key")), { answer: fd.get("answer"), guests: fd.get("guests") ?? 0 }), "Answer saved");
}
export async function checkInPerson(fd: FormData) {
  return serviceAction(RsvpService, (s) => s.checkIn(id(fd), String(fd.get("key")), fd.get("on") !== "false"));
}

/** The new link is returned once; only its hash is kept. */
export async function makeCalendarLink() {
  return serviceAction(CalendarFeedService, async (s) => ({ path: feedPath((await s.reset()).token) }));
}
export async function stopCalendarLink() {
  return serviceAction(CalendarFeedService, (s) => s.revoke(), "Phone calendar link switched off");
}
