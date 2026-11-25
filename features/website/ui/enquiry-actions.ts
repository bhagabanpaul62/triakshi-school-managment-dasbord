"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { ValidationError } from "@smw/feature-kit";
import {
  EnquiryImportService, EnquiryService, EnquirySettingsService, type ImportFile,
} from "../service";

const id = (fd: FormData) => String(fd.get("id") ?? "");
const rest = (fd: FormData) => { const o = formToObject(fd); delete o.id; return o; };

export async function createEnquiry(fd: FormData) {
  return serviceAction(EnquiryService, async (s) => { const r = await s.create(formToObject(fd)); return { id: r.id, duplicates: r.duplicates }; }, "Enquiry added");
}
export async function updateEnquiry(fd: FormData) { return serviceAction(EnquiryService, (s) => s.update(id(fd), rest(fd)), "Enquiry saved"); }
export async function moveEnquiry(fd: FormData) { return serviceAction(EnquiryService, (s) => s.moveTo(id(fd), rest(fd)), "Stage changed"); }
export async function logCall(fd: FormData) { return serviceAction(EnquiryService, (s) => s.logCall(id(fd), rest(fd)), "Call saved"); }
export async function addNote(fd: FormData) { return serviceAction(EnquiryService, (s) => s.note(id(fd), rest(fd)), "Note saved"); }
export async function addTask(fd: FormData) { return serviceAction(EnquiryService, (s) => s.addTask(id(fd), rest(fd)), "Next step added"); }
export async function doneTask(fd: FormData) { return serviceAction(EnquiryService, (s) => s.doneTask(id(fd), rest(fd)), "Done"); }
export async function postponeTask(fd: FormData) { return serviceAction(EnquiryService, (s) => s.postpone(id(fd), rest(fd)), "Moved"); }
export async function bookVisit(fd: FormData) {
  return serviceAction(EnquiryService, async (s) => (await s.bookVisit(id(fd), rest(fd))).mailed, "Visit booked");
}
export async function recordVisit(fd: FormData) { return serviceAction(EnquiryService, (s) => s.recordVisit(id(fd), rest(fd)), "Visit recorded"); }
export async function claimEnquiry(fd: FormData) { return serviceAction(EnquiryService, (s) => s.claim(id(fd)), "You have it"); }
export async function assignEnquiry(fd: FormData) { return serviceAction(EnquiryService, (s) => s.assign(id(fd), String(fd.get("ownerId") ?? "") || null), "Owner changed"); }
export async function mergeEnquiries(fd: FormData) { return serviceAction(EnquiryService, (s) => s.merge(formToObject(fd)), "Joined"); }
export async function deleteEnquiry(fd: FormData) { return serviceAction(EnquiryService, (s) => s.remove(id(fd)), "Enquiry deleted"); }
export async function whatsappEnquiry(fd: FormData) { return serviceAction(EnquiryService, (s) => s.whatsapp(id(fd), rest(fd))); }
export async function emailEnquiry(fd: FormData) {
  return serviceAction(EnquiryService, async (s) => {
    const r = await s.sendEmail(id(fd), rest(fd));
    if (r.result !== "sent") throw new ValidationError({ _: r.result === "no-budget" ? "Today's email limit is used up. It will go tomorrow." : "The email could not be sent. Try again in a few minutes." });
    return r;
  }, "Email sent");
}

/** Board and bulk bar: ids come as repeated "ids" fields. */
export async function bulkEnquiries(fd: FormData) {
  return serviceAction(EnquiryService, (s) => s.bulk({ ...rest(fd), ids: fd.getAll("ids").map(String) }));
}
/** The board's move: the stage the person saw is checked, so two people never overwrite each other. */
export async function boardMove(fd: FormData) { return serviceAction(EnquiryService, (s) => s.moveTo(id(fd), rest(fd))); }

export async function findStudentsForEnquiry(q: string) {
  return serviceAction(EnquiryService, async (s) => (await s.findStudents(q)).map((x) => ({ id: x.id, label: x.label, meta: x.meta })));
}

// ---- settings
export async function saveEnquirySettings(fd: FormData) {
  return serviceAction(EnquirySettingsService, (s) => {
    const o = formToObject(fd);
    const list = (v: unknown) => String(v ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
    const rows = (prefix: string) => Object.keys(o).flatMap((k) => k.match(new RegExp(`^${prefix}(\\d+)_label$`))?.[1] ?? []).map(Number).sort((a, b) => a - b).filter((n) => o[`${prefix}${n}_label`]);
    const templates = rows("t").map((n) => ({ key: o[`t${n}_key`] ?? String(o[`t${n}_label`]).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30), label: o[`t${n}_label`], channel: o[`t${n}_channel`] ?? "whatsapp", text: o[`t${n}_text`] }));
    const people = ([] as unknown[]).concat(o.ownerIds ?? []).map(String);
    return s.save({
      sources: list(o.sources), closeReasons: list(o.closeReasons), templates, owner: { mode: o.ownerMode ?? "none", userIds: people },
      firstCallHours: Number(o.firstCallHours), keepMonths: Number(o.keepMonths), ackText: o.ackText, confirmRetention: o.confirmRetention === "true",
    });
  }, "Settings saved");
}
export async function saveEnquirySeats(fd: FormData) {
  return serviceAction(EnquirySettingsService, (s) => {
    const session = String(fd.get("session") ?? "");
    const names = fd.getAll("className").map(String), seats = fd.getAll("seats").map(String);
    const rows = names.flatMap((className, i) => (className.trim() && seats[i] !== "" ? [{ session, className: className.trim(), seats: seats[i] }] : []));
    return s.saveSeats(session, { rows });
  }, "Seats saved");
}

// ---- import
async function fileFrom(fd: FormData): Promise<ImportFile> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ValidationError({ file: "Choose a file" });
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}
export async function checkEnquiryImport(fd: FormData) { return serviceAction(EnquiryImportService, async (s) => s.dryRun(await fileFrom(fd))); }
export async function commitEnquiryImport(fd: FormData) { return serviceAction(EnquiryImportService, async (s) => s.commit(await fileFrom(fd)), "Enquiries imported"); }

export async function saveEnquiryView(fd: FormData) { return serviceAction(EnquiryService, (s) => s.saveView(formToObject(fd)), "View saved"); }
export async function removeEnquiryView(fd: FormData) { return serviceAction(EnquiryService, (s) => s.removeView(String(fd.get("name") ?? "")), "View deleted"); }
