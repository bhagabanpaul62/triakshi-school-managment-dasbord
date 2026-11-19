"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { PeriodService, TimetableService } from "../service";

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
