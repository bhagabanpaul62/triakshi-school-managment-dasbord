"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { BookingService, DayService, MeetingService } from "../service";

const id = (fd: FormData, key = "id") => String(fd.get(key) ?? "");
const obj = (fd: FormData) => formToObject(fd);

// ---- setup (managers) ----
export async function saveMeeting(fd: FormData) {
  return serviceAction(MeetingService, (s) => s.saveDraft(id(fd) || null, obj(fd)), "Meeting saved");
}
export async function deleteMeeting(fd: FormData) { return serviceAction(MeetingService, (s) => s.remove(id(fd)), "Draft deleted"); }
export async function openMeeting(fd: FormData) { return serviceAction(MeetingService, (s) => s.open(id(fd)), "Booking is open and families are told"); }
export async function closeMeeting(fd: FormData) { return serviceAction(MeetingService, (s) => s.close(id(fd)), "Booking closed"); }
export async function reopenMeeting(fd: FormData) { return serviceAction(MeetingService, (s) => s.reopen(id(fd), obj(fd)), "Booking reopened"); }
export async function cancelMeeting(fd: FormData) { return serviceAction(MeetingService, (s) => s.cancel(id(fd), obj(fd)), "Meeting cancelled and families told"); }
export async function duplicateMeeting(fd: FormData) { return serviceAction(MeetingService, (s) => s.duplicate(id(fd), obj(fd)), "Copied as a new draft"); }
export async function addWindows(fd: FormData) { return serviceAction(MeetingService, (s) => s.addWindows(id(fd, "meetingId"), obj(fd)), "Teacher times added"); }
export async function changeWindow(fd: FormData) { return serviceAction(MeetingService, (s) => s.changeWindow(id(fd, "windowId"), obj(fd))); }
export async function removeWindow(fd: FormData) { return serviceAction(MeetingService, (s) => s.removeWindow(id(fd, "windowId"), obj(fd))); }

// ---- booking (families, or staff for a family) ----
export async function bookSlot(fd: FormData) { return serviceAction(BookingService, (s) => s.book(id(fd, "meetingId"), obj(fd)), "Time booked"); }
export async function changeSlot(fd: FormData) { return serviceAction(BookingService, (s) => s.changeBooking(id(fd, "meetingId"), obj(fd)), "Time changed"); }
export async function cancelSlot(fd: FormData) { return serviceAction(BookingService, (s) => s.cancelBooking(id(fd, "meetingId"), obj(fd)), "Time cancelled"); }
export async function joinWait(fd: FormData) { return serviceAction(BookingService, (s) => s.joinWaitlist(id(fd, "meetingId"), obj(fd)), "You are on the waiting list. We will tell you if a time frees up."); }
export async function leaveWait(fd: FormData) { return serviceAction(BookingService, (s) => s.leaveWaitlist(id(fd, "meetingId"), obj(fd)), "Taken off the waiting list"); }

// ---- the day (teachers) ----
export async function markVisit(fd: FormData) { return serviceAction(DayService, (s) => s.mark(id(fd, "slotId"), obj(fd)), "Marked"); }
export async function saveNotes(fd: FormData) {
  // Empty text must clear a note, so the fields are read as they are, not through formToObject.
  const field = (k: string) => (fd.has(k) ? String(fd.get(k)) : undefined);
  return serviceAction(DayService, (s) => s.saveNotes(id(fd, "slotId"), { privateNote: field("privateNote"), sharedRemark: field("sharedRemark") }), "Notes saved");
}
export async function addWalkIn(fd: FormData) { return serviceAction(DayService, (s) => s.walkIn(id(fd, "meetingId"), obj(fd)), "Walk-in added"); }
