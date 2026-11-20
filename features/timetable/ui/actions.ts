"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { PeriodService, TimetableService } from "../service";
import { BlockService } from "../block-service";
import { GeneratorService } from "../generator-service";
import { RulesService } from "../rules-service";
import { SubstitutionService } from "../substitution-service";

export async function createPeriod(fd: FormData) {
  return serviceAction(PeriodService, (s) => s.create(formToObject(fd)), "Period added");
}
export async function updatePeriod(fd: FormData) {
  return serviceAction(PeriodService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Period updated");
}
export async function deletePeriod(fd: FormData) {
  return serviceAction(PeriodService, (s) => s.remove(String(fd.get("id"))), "Period deleted");
}
export async function applyPeriodPreset() {
  return serviceAction(PeriodService, (s) => s.applyPreset(), "Standard bell schedule created");
}

export async function setSlot(fd: FormData) {
  return serviceAction(TimetableService, (s) => s.setSlot(formToObject(fd)), "Period saved");
}
export async function setBlock(fd: FormData) {
  return serviceAction(TimetableService, (s) => s.setBlock(formToObject(fd)), "Block placed for the whole class");
}
export async function clearSlot(fd: FormData) {
  return serviceAction(TimetableService, (s) => s.clearSlot(formToObject(fd)), "Period cleared");
}
export async function autoFillSection(fd: FormData) {
  const r = await serviceAction(TimetableService, (s) => s.autoFill(String(fd.get("sectionId"))), "Empty periods filled");
  if (!r.ok) return r;
  const { filled, empty } = r.data;
  r.message = !filled ? "Nothing to fill: the rest are busy with other sections" : `Filled ${filled} ${filled === 1 ? "period" : "periods"}${empty ? `, ${empty} left empty because teachers are busy` : ""}`;
  return r;
}

// ---------- generator ----------


/** The loads grid posts `p:<classId>:<subjectId>`, `d:...` and `k:...` fields. */
export async function saveLoadsAction(fd: FormData) {
  const rows = [...fd.keys()].filter((k) => k.startsWith("p:")).map((k) => {
    const [, classId, subjectId] = k.split(":");
    const roomKind = String(fd.get(`k:${classId}:${subjectId}`) ?? "").trim();
    return { classId, subjectId, periodsPerWeek: String(fd.get(k) || "0"), doublePeriods: String(fd.get(`d:${classId}:${subjectId}`) || "0"), roomKind };
  });
  return serviceAction(RulesService, (s) => s.saveLoads({ rows }), "Periods per week saved");
}
export async function saveTeacherRuleAction(fd: FormData) {
  return serviceAction(RulesService, (s) => s.saveTeacherRule(formToObject(fd)), "Teacher limits saved");
}
export async function addRoom(fd: FormData) {
  return serviceAction(RulesService, (s) => s.addRoom(formToObject(fd)), "Room added");
}
export async function removeRoom(fd: FormData) {
  return serviceAction(RulesService, (s) => s.removeRoom(String(fd.get("id"))), "Room removed");
}
export async function saveSettingsAction(fd: FormData) {
  return serviceAction(RulesService, (s) => s.saveSettings(formToObject(fd)), "Rules saved");
}
export async function saveOverride(fd: FormData) {
  return serviceAction(RulesService, (s) => s.saveOverride(formToObject(fd)), "Special day saved");
}
export async function removeOverride(fd: FormData) {
  return serviceAction(RulesService, (s) => s.removeOverride(String(fd.get("id"))), "Special day removed");
}
export async function generateDraft(fd: FormData) {
  const r = await serviceAction(GeneratorService, (s) => s.generate(formToObject(fd)), "Draft built");
  if (r.ok) r.message = `Placed ${r.data.placed} periods${r.data.unplaced ? `, ${r.data.unplaced} could not be placed` : ""}${r.data.changed ? `, ${r.data.changed} cells changed` : ""}`;
  return r;
}
export async function publishDraft(fd: FormData) {
  const r = await serviceAction(GeneratorService, (s) => s.publish(formToObject(fd)), "Published. This is now the live timetable");
  if (r.ok && r.data.publishOn) r.message = `Scheduled. It goes live on the morning of ${r.data.publishOn}`;
  return r;
}
export async function unscheduleDraft(fd: FormData) {
  return serviceAction(GeneratorService, (s) => s.unschedule(formToObject(fd)), "Taken off the schedule. It stays a draft");
}
export async function discardDraft(fd: FormData) {
  return serviceAction(GeneratorService, (s) => s.discard(formToObject(fd)), "Draft discarded");
}
export async function setLocked(fd: FormData) {
  const r = await serviceAction(GeneratorService, (s) => s.setLocked(formToObject(fd)), "Updated");
  if (r.ok) r.message = `${r.data.changed} ${r.data.changed === 1 ? "period" : "periods"} updated`;
  return r;
}

/** The electives step posts `subject:<i>`, `teacher:<i>` and `room:<i>` per alternative. */
export async function saveBlockAction(fd: FormData) {
  const options = [...fd.keys()].filter((k) => k.startsWith("subject:")).map((k) => {
    const i = k.split(":")[1];
    return { subjectId: String(fd.get(k)), teacherId: String(fd.get(`teacher:${i}`) ?? ""), roomId: String(fd.get(`room:${i}`) ?? "") };
  });
  const { id, classId, name, periodsPerWeek, doubles } = formToObject(fd) as Record<string, string>;
  return serviceAction(BlockService, (s) => s.save({ id, classId, name, periodsPerWeek, doubles, options }), "Block saved");
}
export async function removeBlockAction(fd: FormData) {
  return serviceAction(BlockService, (s) => s.remove(String(fd.get("id"))), "Block deleted");
}

// ---------- cover ----------

export async function assignCover(fd: FormData) {
  return serviceAction(SubstitutionService, (s) => s.assign(formToObject(fd)), "Cover assigned and the teacher notified");
}
export async function clearCover(fd: FormData) {
  return serviceAction(SubstitutionService, (s) => s.clear(formToObject(fd)), "Cover removed");
}

// ---------- copy week ----------

export async function copyWeek(fd: FormData) {
  const r = await serviceAction(TimetableService, (s) => s.copyWeek(formToObject(fd)), "Week copied");
  if (r.ok) r.message = `Copied ${r.data.copied} periods${r.data.skipped.length ? `, skipped ${r.data.skipped.length}: ${r.data.skipped.slice(0, 4).map((x) => `${x.period} ${x.day === 0 ? "" : ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x.day]} (${x.reason})`).join("; ")}${r.data.skipped.length > 4 ? "..." : ""}` : ""}`;
  return r;
}
