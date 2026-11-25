"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import type { UploadedFile } from "@smw/feature-messages/core";
import { CategoryService, RequestService } from "../service";

const id = (fd: FormData) => String(fd.get("id") ?? "");
const text = (fd: FormData) => String(fd.get("text") ?? fd.get("body") ?? "");
/** The files of a form as bytes; nothing when none were chosen. */
async function uploads(fd: FormData): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  for (const f of fd.getAll("files")) if (f instanceof File && f.size > 0) out.push({ name: f.name, type: f.type, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) });
  return out;
}

export async function raiseRequest(fd: FormData) {
  const o = formToObject(fd);
  delete o.files;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (k.startsWith("v_") && typeof v === "string") values[k.slice(2)] = v;
  return serviceAction(RequestService, async (s) => s.raise({ ...o, values }, await uploads(fd)));
}
export async function findStudents(q: string) { return serviceAction(RequestService, (s) => s.findStudents(q)); }
export async function askContext(studentId: string) { return serviceAction(RequestService, (s) => s.askContext(studentId || undefined)); }

/** The one box under a conversation: the family replies; staff answer, ask the family, or write a note. */
export async function sendReply(fd: FormData) {
  const mode = String(fd.get("mode") ?? "reply");
  return serviceAction(RequestService, async (s) => {
    const files = await uploads(fd);
    if (mode === "note") return s.internalNote(id(fd), text(fd));
    if (mode === "ask") return s.askFamily(id(fd), text(fd), files);
    if (mode === "answer") return s.answer(id(fd), text(fd), files);
    return s.reply(id(fd), text(fd), files);
  });
}

export async function claimRequest(fd: FormData) { return serviceAction(RequestService, (s) => s.claim(id(fd)), "You have it"); }
export async function startRequest(fd: FormData) { return serviceAction(RequestService, (s) => s.start(id(fd)), "Marked as in progress"); }
export async function assignRequest(fd: FormData) { return serviceAction(RequestService, (s) => s.assign(formToObject(fd)), "Given"); }
export async function changeCategory(fd: FormData) { return serviceAction(RequestService, (s) => s.setCategory(formToObject(fd)), "Category changed"); }
export async function resolveRequest(fd: FormData) { return serviceAction(RequestService, (s) => s.resolve(id(fd), fd.get("note") || undefined), "Marked as resolved"); }
export async function closeRequest(fd: FormData) { return serviceAction(RequestService, (s) => s.close(id(fd), fd.get("reason") || undefined), "Closed"); }
export async function reopenRequest(fd: FormData) { return serviceAction(RequestService, (s) => s.reopen(formToObject(fd)), "Opened again"); }
export async function escalateRequest(fd: FormData) { return serviceAction(RequestService, (s) => s.escalate(formToObject(fd)), "Sent higher"); }
export async function mergeRequest(fd: FormData) { return serviceAction(RequestService, (s) => s.merge(formToObject(fd)), "Joined"); }
export async function giveFeedback(fd: FormData) { return serviceAction(RequestService, (s) => s.feedback(formToObject(fd)), "Thank you"); }

// ---- categories
/** The settings form numbers its rows (l3_label, f7_label); they need not be in a row: this turns them into the category, in order. */
export async function saveCategory(fd: FormData) {
  const o = formToObject(fd);
  const rows = (prefix: string) => Object.keys(o).flatMap((k) => k.match(new RegExp(`^${prefix}(\\d+)_label$`))?.[1] ?? []).map(Number).sort((a, b) => a - b).filter((n) => o[`${prefix}${n}_label`]);
  const escalation = rows("l").map((n) => ({ label: o[`l${n}_label`], role: o[`l${n}_role`] ?? "admin", afterDays: o[`l${n}_days`] ?? 2 }));
  // A question keeps the id it had, so answers already given still belong to it.
  const fields = rows("f").map((n) => ({
    id: o[`f${n}_id`], label: o[`f${n}_label`], kind: o[`f${n}_kind`] ?? "text", required: o[`f${n}_required`] === "true",
    options: typeof o[`f${n}_options`] === "string" ? String(o[`f${n}_options`]).split(",").map((x) => x.trim()).filter(Boolean) : undefined,
  }));
  return serviceAction(CategoryService, (s) => s.save({ id: o.id, name: o.name, nature: o.nature, ownerRole: o.ownerRole, targetDays: o.targetDays, escalation, fields }), "Category saved");
}
export async function setCategoryActive(fd: FormData) { return serviceAction(CategoryService, (s) => s.setActive(id(fd), fd.get("active") === "1"), "Updated"); }
export async function deleteCategory(fd: FormData) { return serviceAction(CategoryService, (s) => s.remove(id(fd)), "Category deleted"); }
export async function moveCategory(fd: FormData) {
  return serviceAction(CategoryService, async (s) => {
    const ids = (await s.list()).map((c) => c.id), i = ids.indexOf(id(fd)), j = i + (fd.get("dir") === "up" ? -1 : 1);
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await s.reorder(ids);
  });
}
