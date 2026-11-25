"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { ValidationError } from "@smw/feature-kit";
import { EligibilityService } from "../eligibility";
import type { UploadedFile } from "../files";
import { LeaveBalanceService } from "../leave-balances";
import { LeaveService } from "../leave-service";
import { LeaveTypeService } from "../leave-types";
import { PeriodAttendanceService } from "../period-service";
import { HolidayService } from "../holiday-service";
import { StaffAttendanceService, StudentAttendanceService } from "../service";

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
/** The days ticked in "copy last year" or the ready list, sent as one JSON field. */
export async function addHolidays(fd: FormData) {
  return serviceAction(HolidayService, (s) => s.addMany(formToObject(fd)), "Holidays added");
}
const sheetFrom = async (fd: FormData) => {
  const v = fd.get("file");
  if (!(v instanceof File) || v.size === 0) throw new ValidationError({ file: "Choose a file" });
  return { name: v.name, bytes: new Uint8Array(await v.arrayBuffer()) };
};
export async function checkHolidayImport(fd: FormData) {
  return serviceAction(HolidayService, async (s) => s.importCheck(await sheetFrom(fd)));
}
export async function commitHolidayImport(fd: FormData) {
  return serviceAction(HolidayService, async (s) => s.importCommit(await sheetFrom(fd)));
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

export async function previewLeave(fd: FormData) {
  return serviceAction(LeaveBalanceService, (s) => s.preview(formToObject(fd)));
}
export async function adjustLeave(fd: FormData) {
  return serviceAction(LeaveBalanceService, (s) => s.adjust(formToObject(fd)), "Balance changed");
}
export async function createLeaveType(fd: FormData) {
  return serviceAction(LeaveTypeService, (s) => s.create(formToObject(fd)), "Leave type added");
}
export async function updateLeaveType(fd: FormData) {
  return serviceAction(LeaveTypeService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Leave type updated");
}
export async function deleteLeaveType(fd: FormData) {
  return serviceAction(LeaveTypeService, (s) => s.remove(String(fd.get("id"))), "Leave type removed");
}
