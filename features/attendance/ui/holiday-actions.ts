"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { HolidayService, type Declared } from "../holiday-service";

const told = (n: number) => (n === 1 ? "1 person was told." : n > 1 ? `${n} people were told.` : "");
const say = (base: string, n: number) => [base, told(n)].filter(Boolean).join(" ");

export async function createHoliday(fd: FormData) {
  const r = await serviceAction(HolidayService, (s) => s.create(formToObject(fd)));
  return r.ok ? { ...r, message: say("Holiday added.", r.data.told) } : r;
}
export async function updateHoliday(fd: FormData) {
  return serviceAction(HolidayService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Holiday updated");
}
export async function deleteHoliday(fd: FormData) {
  return serviceAction(HolidayService, (s) => s.remove(String(fd.get("id"))), "Holiday removed");
}
export async function addHolidays(fd: FormData) {
  const r = await serviceAction(HolidayService, (s) => s.addMany(formToObject(fd)));
  return r.ok ? { ...r, message: say("Holidays added.", (r.data as Declared[]).reduce((n, d) => n + d.told, 0)) } : r;
}
