"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { HolidayService, StaffAttendanceService, StudentAttendanceService } from "../service";

export async function markStudentAttendance(fd: FormData) {
  return serviceAction(StudentAttendanceService, (s) => s.mark(formToObject(fd)), "Attendance saved");
}
export async function markStaffAttendance(fd: FormData) {
  return serviceAction(StaffAttendanceService, (s) => s.mark(formToObject(fd)), "Staff attendance saved");
}

export async function createHoliday(fd: FormData) {
  return serviceAction(HolidayService, (s) => s.create(formToObject(fd)), "Holiday added");
}
export async function updateHoliday(fd: FormData) {
  return serviceAction(HolidayService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Holiday updated");
}
export async function deleteHoliday(fd: FormData) {
  return serviceAction(HolidayService, (s) => s.remove(String(fd.get("id"))), "Holiday removed");
}
