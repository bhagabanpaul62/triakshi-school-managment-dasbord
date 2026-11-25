"use server";

import { redirect } from "next/navigation";
import { formToObject, serviceAction } from "@smw/runtime";
import { PreferenceService } from "@smw/feature-notifications/prefs";
import { BatchService } from "../batch";
import type { UploadedFile } from "../files";
import { MessageService } from "../service";
import { SafeguardService } from "../safeguard";

/** Files stay in the action: the service gets plain bytes. */
async function filesOf(fd: FormData, name = "files"): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  for (const f of fd.getAll(name)) if (f instanceof File && f.size > 0) out.push({ name: f.name, type: f.type, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) });
  return out;
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

// ---- writing ----
export async function sendMessage(fd: FormData) {
  return serviceAction(MessageService, async (s) => { await s.send(str(fd, "threadId"), fd.get("text"), { clientId: str(fd, "clientId") || undefined, files: await filesOf(fd) }); return null; });
}
export async function startThread(fd: FormData) {
  const input = formToObject(fd);
  input.body = fd.get("text") ?? fd.get("body");
  return serviceAction(MessageService, async (s) => s.start(input, await filesOf(fd)));
}
/** When the people a new message goes to would be told (null: at once), so the form says it before sending. */
export async function holdFor(ids: string[], studentId?: string) { return serviceAction(MessageService, (s) => s.holdFor(ids, studentId || undefined).then((d) => d?.toISOString() ?? null)); }
export async function searchStudents(fd: FormData) { return serviceAction(MessageService, (s) => s.students(str(fd, "q"))); }
export async function searchStaff(fd: FormData) { return serviceAction(MessageService, (s) => s.contacts(str(fd, "q"), str(fd, "studentId") || undefined)); }

// ---- my marks ----
export async function markThread(threadId: string, flag: "pinned" | "muted" | "archived", on: boolean) {
  if (!["pinned", "muted", "archived"].includes(flag)) return { ok: false as const, error: "Not a valid choice", code: "validation" };
  return serviceAction(MessageService, (s) => s.mark(String(threadId), flag, !!on));
}
export async function markUnread(threadId: string) { return serviceAction(MessageService, (s) => s.markUnread(String(threadId))); }
export async function removeMessage(messageId: string) { return serviceAction(MessageService, (s) => s.remove(String(messageId)), "Message removed"); }
export async function reportConcern(fd: FormData) { return serviceAction(MessageService, (s) => s.report(formToObject(fd))); }
export async function saveReply(fd: FormData) { return serviceAction(MessageService, (s) => s.saveReply(formToObject(fd)), "Reply saved"); }
export async function deleteReply(id: string) { return serviceAction(MessageService, (s) => s.deleteReply(String(id)), "Reply deleted"); }
export async function moveToTeacher(fd: FormData) { return serviceAction(MessageService, (s) => s.reassign(str(fd, "threadId"), str(fd, "teacherId")), "Moved to the new teacher"); }

// ---- message families ----
export async function previewBatch(fd: FormData) { return serviceAction(BatchService, (s) => s.preview(fd.get("audience"))); }
export async function sendBatch(fd: FormData) { return serviceAction(BatchService, (s) => s.send(formToObject(fd))); }

// ---- safeguarding ----
export async function openReview(fd: FormData) {
  const r = await serviceAction(SafeguardService, (s) => s.open(formToObject(fd)).then(() => null));
  if (r.ok) redirect(`/app/safeguarding/review/${str(fd, "threadId")}`);
  return r;
}
export async function handleReport(fd: FormData) { return serviceAction(SafeguardService, (s) => s.handle(formToObject(fd)), "Saved"); }
export async function restrictPerson(fd: FormData) { return serviceAction(SafeguardService, (s) => s.restrict(formToObject(fd)), "Limit set"); }
export async function liftRestriction(id: string) { return serviceAction(SafeguardService, (s) => s.lift(String(id)), "Limit lifted"); }

// ---- my hours and away (the person's own settings; the service lives in notifications) ----
export async function saveMyHours(input: unknown) { return serviceAction(PreferenceService, (s) => s.saveQuiet(input)); }
export async function saveMyAway(until: unknown, text?: unknown) { return serviceAction(PreferenceService, (s) => s.setAway(until, text)); }
export async function searchPeople(fd: FormData) { return serviceAction(SafeguardService, (s) => s.people(str(fd, "q"))); }
