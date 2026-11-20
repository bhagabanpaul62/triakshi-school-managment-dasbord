"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { EligibilityService } from "../eligibility";
import type { UploadedFile } from "../files";
import { LeaveService } from "../leave-service";
import { PeriodAttendanceService } from "../period-service";
import { HolidayService, StaffAttendanceService, StudentAttendanceService } from "../service";

/** The optional file from a form field as plain values: `File` never reaches a service. */
async function uploadFrom(fd: FormData, field: string): Promise<UploadedFile | undefined> {
  const v = fd.get(field);
  return v instanceof File && v.size > 0 ? { name: v.name, type: v.type, size: v.size, bytes: new Uint8Array(await v.arrayBuffer()) } : undefined;
}

export async function markStudentAttendance(fd: FormData) {
  return serviceAction(StudentAttendanceService, (s) => s.mark(formToObject(fd)), "Attendance saved");
}
export async function markPeriodAttendance(fd: FormData) {
  return serviceAction(PeriodAttendanceService, (s) => s.markPeriod(formToObject(fd)), "Period attendance saved");
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

export async function applyLeave(fd: FormData) {
  return serviceAction(LeaveService, async (s) => s.apply(formToObject(fd), await uploadFrom(fd, "file")), "Leave request sent");
}
export async function cancelLeave(fd: FormData) {
  return serviceAction(LeaveService, (s) => s.cancel(String(fd.get("id"))), "Request withdrawn");
}
export async function editLeave(fd: FormData) {
  return serviceAction(LeaveService, (s) => s.edit(formToObject(fd)), "Request updated");
}
export async function reverseLeave(fd: FormData) {
  return serviceAction(LeaveService, (s) => s.reverse(formToObject(fd)), "Decision reversed");
}
export async function decideLeave(fd: FormData) {
  return serviceAction(LeaveService, (s) => s.decide(formToObject(fd)), "Decision saved");
}
export async function saveAttendanceSettings(fd: FormData) {
  return serviceAction(EligibilityService, (s) => s.updateSettings(formToObject(fd)), "Settings saved");
}
export async function addCondonation(fd: FormData) {
  return serviceAction(EligibilityService, async (s) => s.addCondonation(formToObject(fd), await uploadFrom(fd, "file")), "Condonation added");
}
export async function removeCondonation(fd: FormData) {
  return serviceAction(EligibilityService, (s) => s.removeCondonation(String(fd.get("id"))), "Condonation removed");
}
export async function updateCondonation(fd: FormData) {
  return serviceAction(EligibilityService, (s) => s.updateCondonation(formToObject(fd)), "Condonation updated");
}
