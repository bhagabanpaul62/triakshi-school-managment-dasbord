"use server";

import { after } from "next/server";
import { ValidationError } from "@smw/feature-kit";
import { AudienceService } from "@smw/feature-notifications/audience";
import { CommGroupService } from "@smw/feature-notifications/audience-groups";
import { actionCtx, formToObject, runAction, serviceAction } from "@smw/runtime";
import { fanOut } from "../fan-out";
import { AnnouncementCategoryService, NoticeFileService, NoticeService, ReportService, ResponseService, TemplateService, type UploadedFile } from "../service";

const id = (fd: FormData, key = "id") => String(fd.get(key) ?? "");
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "");
/** The write page sends everything it knows as one JSON field, so a cleared field really clears. */
const json = (fd: FormData, key = "payload") => { try { return JSON.parse(text(fd, key) || "{}"); } catch { throw new ValidationError({ [key]: "Could not read what was sent" }); } };

/** Start the sending after the response, so the person is not kept waiting. A failure is logged; the minute job finishes it. */
const sendAfter = (schoolId: string, noticeId: string) => after(async () => {
  try { await fanOut(schoolId, noticeId); } catch (e) { console.error("notice fan-out failed; comms.publish-due will retry", noticeId, e); }
});
/** The ones that make a notice due at once: send after the answer is given. */
const dueNow = (run: (s: NoticeService) => Promise<{ id: string }>, message?: string) =>
  runAction(async () => { const ctx = await actionCtx(); const out = await run(new NoticeService(ctx)); sendAfter(ctx.schoolId, out.id); return out; }, message);

// ---- writing ----
export async function saveNotice(fd: FormData) { return serviceAction(NoticeService, (s) => s.saveDraft(json(fd))); }
export async function correctNotice(fd: FormData) {
  return serviceAction(NoticeService, (s) => s.correct({ id: id(fd), note: text(fd, "note") || undefined, edits: json(fd) }, { notifyAgain: text(fd, "notifyAgain") === "1" }), "Correction saved");
}
/** What publishing would do: who it reaches, who will not be reached and why, and whether it needs approval. */
export async function checkNotice(fd: FormData) {
  return runAction(async () => {
    const ctx = await actionCtx();
    const audience = text(fd, "audience");
    const [reach, people] = await Promise.all([new NoticeService(ctx).reachFor(audience, text(fd, "website") === "1"), new AudienceService(ctx).preview(audience)]);
    return { ...reach, people };
  });
}
export async function deleteDraft(fd: FormData) { return serviceAction(NoticeService, (s) => s.deleteDraft(id(fd)), "Draft deleted"); }

const upload = async (v: FormDataEntryValue | null): Promise<UploadedFile> => {
  if (!(v instanceof File) || v.size === 0) throw new ValidationError({ file: "Choose a file first" });
  return { name: v.name, type: v.type, size: v.size, bytes: new Uint8Array(await v.arrayBuffer()) };
};
/** One file per call (the body limit is per call). Returns the files now on the notice. */
export async function addNoticeFile(fd: FormData) {
  return runAction(async () => {
    const ctx = await actionCtx();
    await new NoticeFileService(ctx).add(id(fd), await upload(fd.get("file")));
    return (await new NoticeService(ctx).get(id(fd))).files;
  });
}
export async function removeNoticeFile(fd: FormData) {
  return runAction(async () => {
    const ctx = await actionCtx();
    await new NoticeFileService(ctx).remove(id(fd, "fileId"));
    return (await new NoticeService(ctx).get(id(fd))).files;
  });
}

/** `ids` is the new order of the files on the notice. Returns the files as they now stand. */
export async function reorderNoticeFiles(fd: FormData) {
  return runAction(async () => {
    const ctx = await actionCtx();
    await new NoticeFileService(ctx).reorder(id(fd), json(fd, "ids"));
    return (await new NoticeService(ctx).get(id(fd))).files;
  });
}

// ---- sending ----
export async function submitNotice(fd: FormData) { return serviceAction(NoticeService, (s) => s.submit(id(fd))); }
/** A 30-second hold for a plain notice (the job sends it); an urgent alert is due at once. */
export async function publishNotice(fd: FormData) {
  return runAction(async () => {
    const ctx = await actionCtx();
    const out = await new NoticeService(ctx).publish(id(fd), { confirmed: text(fd, "confirmed") === "1" });
    if (out.sendAt && out.sendAt.getTime() <= Date.now()) sendAfter(ctx.schoolId, out.id);
    return out;
  });
}
export async function scheduleNotice(fd: FormData) { return serviceAction(NoticeService, (s) => s.schedule(id(fd), text(fd, "at"))); }
export async function unscheduleNotice(fd: FormData) { return serviceAction(NoticeService, (s) => s.unschedule(id(fd)), "Taken off the schedule"); }
export async function sendScheduledNow(fd: FormData) { return dueNow((s) => s.sendNow(id(fd)), "Sent"); }
export async function undoNotice(fd: FormData) { return serviceAction(NoticeService, (s) => s.undo(id(fd)), "Not sent. It is a draft again."); }
export async function releaseNotice(fd: FormData) { return dueNow((s) => s.release(id(fd)), "Sent"); }

// ---- approving ----
export async function recallNotice(fd: FormData) { return serviceAction(NoticeService, (s) => s.recall(id(fd)), "Taken back. It is a draft again."); }
export async function approveNotice(fd: FormData) {
  const edits = fd.has("payload") ? json(fd) : undefined;
  return serviceAction(NoticeService, (s) => s.approve({ id: id(fd), reason: text(fd, "reason") || undefined, edits }), "Approved");
}
export async function askChanges(fd: FormData) { return serviceAction(NoticeService, (s) => s.askChanges({ id: id(fd), note: text(fd, "note") }), "Sent back with your note"); }
export async function rejectNotice(fd: FormData) { return serviceAction(NoticeService, (s) => s.reject({ id: id(fd), reason: text(fd, "reason") }), "Rejected"); }

// ---- after it is out ----
export async function withdrawNotice(fd: FormData) { return serviceAction(NoticeService, (s) => s.withdraw(id(fd), text(fd, "reason")), "Withdrawn. People now see that the school withdrew it."); }
export async function duplicateNotice(fd: FormData) { return serviceAction(NoticeService, (s) => s.duplicate(id(fd)), "Copied to a new draft"); }
/** A correction the writer may not make alone: the same edits, saved as a new draft to send for approval. */
export async function saveCorrectionAsNew(fd: FormData) { return serviceAction(NoticeService, (s) => s.duplicate(id(fd), json(fd)), "Saved as a new notice. Send it for approval."); }
export async function saveAsTemplate(fd: FormData) { return serviceAction(TemplateService, (s) => s.saveFrom(id(fd), text(fd, "name")), "Saved as a template"); }

// ---- the report ----
export async function funnelNow(fd: FormData) { return serviceAction(ReportService, (s) => s.funnel(id(fd))); }
export async function nudgeAll(fd: FormData) { return serviceAction(ReportService, (s) => s.nudge(id(fd))); }
export async function nudgeChosen(fd: FormData) { return serviceAction(ReportService, (s) => s.nudgeSome(id(fd), json(fd, "ids"))); }
export async function resendNotice(fd: FormData) { return serviceAction(ReportService, (s) => s.resend(id(fd), text(fd, "to") === "unreached" ? "unreached" : "unseen")); }

// ---- answering ----
const files = async (fd: FormData) => {
  const out: Record<string, UploadedFile> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("file:") && v instanceof File && v.size > 0) out[k.slice(5)] = await upload(v);
  return out;
};
export async function respondNotice(fd: FormData) {
  return runAction(async () => new ResponseService(await actionCtx()).respond(json(fd), await files(fd)));
}
export async function recordPaperAnswer(fd: FormData) {
  const slip = fd.get("slip");
  return runAction(async () => new ResponseService(await actionCtx()).recordPaper(json(fd), slip instanceof File && slip.size > 0 ? await upload(slip) : undefined), "Written down as a paper answer");
}

// ---- settings ----
export async function saveCategory(fd: FormData) {
  const body = formToObject(fd);
  return serviceAction(AnnouncementCategoryService, (s) => (body.id ? s.update(String(body.id), body) : s.create(body)), "Category saved");
}
export async function deleteCategory(fd: FormData) { return serviceAction(AnnouncementCategoryService, (s) => s.remove(id(fd)), "Category deleted"); }
export async function deleteTemplate(fd: FormData) { return serviceAction(TemplateService, (s) => s.remove(id(fd)), "Template deleted"); }
export async function saveGroup(fd: FormData) {
  const body = formToObject(fd);
  return serviceAction(CommGroupService, (s) => (body.id ? s.update(String(body.id), body) : s.create(body)), "Group saved");
}
export async function deleteGroup(fd: FormData) { return serviceAction(CommGroupService, (s) => s.remove(id(fd)), "Group deleted"); }
