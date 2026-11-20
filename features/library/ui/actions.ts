"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { paise, shortDate } from "@smw/ui/format";
import { BookService, HoldService, LibrarySettingsService, LoanService } from "../service";

export async function createBook(fd: FormData) {
  return serviceAction(BookService, (s) => s.create(formToObject(fd)), "Book added");
}
export async function updateBook(fd: FormData) {
  return serviceAction(BookService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Book updated");
}
export async function deleteBook(fd: FormData) {
  return serviceAction(BookService, (s) => s.remove(String(fd.get("id"))), "Book deleted");
}
export async function addCopies(fd: FormData) {
  return serviceAction(BookService, (s) => s.addCopies(String(fd.get("bookId")), formToObject(fd)), "Copies added");
}
export async function markCopy(fd: FormData) {
  return serviceAction(BookService, (s) => s.markCopy(String(fd.get("id")), { status: fd.get("status") }), "Copy updated");
}

export async function issueBook(fd: FormData) {
  return serviceAction(LoanService, (s) => s.issue(formToObject(fd)), "Book issued");
}
export async function returnLoan(fd: FormData) {
  const r = await serviceAction(LoanService, (s) => s.returnLoan(String(fd.get("id"))));
  if (!r.ok) return r;
  return { ...r, message: r.data.finePaise > 0 ? `Returned ${r.data.daysLate} days late. Collect a fine of ${paise(r.data.finePaise)}.` : "Book returned" };
}
export async function waiveFine(fd: FormData) {
  return serviceAction(LoanService, (s) => s.waiveFine(String(fd.get("id"))), "Fine waived");
}

/** Issue desk search. Read-only, so they return data instead of toasting. */
export async function findBooks(q: string) {
  return serviceAction(LoanService, (s) => s.findAvailableBooks(q));
}
export async function findBorrowers(q: string) {
  return serviceAction(LoanService, (s) => s.findBorrowers(q));
}

export async function renewLoan(fd: FormData) {
  const r = await serviceAction(LoanService, (s) => s.renew(String(fd.get("id"))));
  return r.ok ? { ...r, message: `Renewed. Due ${shortDate(r.data.dueOn)}.` } : r;
}
export async function saveSettings(fd: FormData) {
  return serviceAction(LibrarySettingsService, (s) => s.save(formToObject(fd)), "Library rules saved");
}
/** The scan box: read-only, so it returns the copy instead of toasting. */
export async function scanCopy(text: string) {
  return serviceAction(LoanService, (s) => s.scan(text));
}
export async function placeHold(fd: FormData) {
  return serviceAction(HoldService, (s) => s.place(String(fd.get("bookId")), fd.get("studentId") ? String(fd.get("studentId")) : undefined), "Reserved. You will get a notice when it is ready.");
}
export async function cancelHold(fd: FormData) {
  return serviceAction(HoldService, (s) => s.cancel(String(fd.get("id"))), "Hold cancelled");
}
