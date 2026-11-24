"use server";

import { ApprovalDeskService } from "@smw/feature-finance/service";
import { formToObject, serviceAction } from "@smw/runtime";
import {
  AssignmentService, DeclarationService, ExitService, LoanService, PayConfigService, PayoutService, ProfileService, RateService, RemittanceService, RunService, StructureService, type SealedField,
} from "../service";

const id = (fd: FormData) => String(fd.get("id"));
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const num = (fd: FormData, k: string) => Number(fd.get(k));
/** A form posts one JSON `payload` when it holds a list (structure components, typed lines). */
const payload = (fd: FormData) => JSON.parse(String(fd.get("payload") ?? "{}")) as unknown;
const ids = (fd: FormData) => fd.getAll("itemIds").map(String);

// people
export async function saveProfile(fd: FormData) { return serviceAction(ProfileService, (s) => s.save(text(fd, "userId"), formToObject(fd)).then(() => ({ id: text(fd, "userId") })), "Pay details saved"); }
export async function switchPayBy(fd: FormData) { return serviceAction(ProfileService, (s) => s.switchPayBy(text(fd, "userId"), text(fd, "payBy") as "cash"), "Changed how they are paid"); }
export async function revealDetail(fd: FormData) { return serviceAction(ProfileService, (s) => s.reveal(text(fd, "userId"), text(fd, "field") as SealedField).then((value) => ({ value }))); }
export async function assignPay(fd: FormData) { return serviceAction(AssignmentService, (s) => s.assign({ ...formToObject(fd), grossPaise: num(fd, "grossPaise") }).then((r) => ({ id: r.id })), "Pay saved"); }
export async function previewRaise(fd: FormData) { return serviceAction(AssignmentService, (s) => s.bulkRaise({ percentBp: Math.round(num(fd, "percent") * 100), fromDate: text(fd, "fromDate"), department: text(fd, "department") || undefined }, { preview: true })); }
export async function commitRaise(fd: FormData) { return serviceAction(AssignmentService, (s) => s.bulkRaise({ percentBp: Math.round(num(fd, "percent") * 100), fromDate: text(fd, "fromDate"), department: text(fd, "department") || undefined }, { preview: false }).then((r) => ({ count: r.rows.length })), "Raise saved"); }
async function sheet(fd: FormData, commit: boolean) { const f = fd.get("file") as File; return serviceAction(AssignmentService, async (s) => s.importSheet({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, { commit })); }
export async function checkPaySheet(fd: FormData) { return sheet(fd, false); }
export async function importPaySheet(fd: FormData) { return sheet(fd, true); }

// structures
export async function saveStructure(fd: FormData) { return serviceAction(StructureService, (s) => s.save(payload(fd), fd.get("id") ? id(fd) : undefined).then((r) => ({ id: r.id })), "Structure saved"); }
export async function copyStructure(fd: FormData) { return serviceAction(StructureService, (s) => s.copy(id(fd)).then((r) => ({ id: r.id })), "Copied"); }
export async function deleteStructure(fd: FormData) { return serviceAction(StructureService, (s) => s.remove(id(fd)), "Structure deleted"); }

// runs
export async function createRun(fd: FormData) { return serviceAction(RunService, (s) => s.create(formToObject(fd)).then((r) => ({ id: r.id })), "Run started"); }
export async function recomputeRun(fd: FormData) { return serviceAction(RunService, (s) => s.recompute(id(fd)), "Worked out again"); }
export async function reviewRun(fd: FormData) { return serviceAction(RunService, (s) => s.review(id(fd)).then((r) => ({ id: r.id })), "Run reviewed"); }
export async function reopenRun(fd: FormData) { return serviceAction(RunService, (s) => s.reopen(id(fd)).then((r) => ({ id: r.id })), "Run reopened"); }
export async function cancelRun(fd: FormData) { return serviceAction(RunService, (s) => s.cancel(id(fd)).then((r) => ({ id: r.id })), "Run cancelled"); }
export async function submitRun(fd: FormData) { return serviceAction(RunService, (s) => s.submit(id(fd), text(fd, "note") || undefined).then((r) => ({ id: r.id })), "Sent for approval"); }
export async function requestRecall(fd: FormData) { return serviceAction(RunService, (s) => s.requestRecall(id(fd), formToObject(fd)).then((r) => ({ id: r.id })), "Recall sent for approval"); }
export async function addPerson(fd: FormData) { return serviceAction(RunService, (s) => s.addPerson(id(fd), text(fd, "userId")), "Person added"); }
export async function skipPerson(fd: FormData) { return serviceAction(RunService, (s) => s.skip(text(fd, "itemId"), formToObject(fd)), "Left out of this run"); }
export async function includePerson(fd: FormData) { return serviceAction(RunService, (s) => s.include(text(fd, "itemId")), "Back in the run"); }
export async function addAdjustment(fd: FormData) { return serviceAction(RunService, (s) => s.addAdjustment(text(fd, "itemId"), { ...formToObject(fd), amountPaise: num(fd, "amountPaise") }), "Added"); }
export async function removeAdjustment(fd: FormData) { return serviceAction(RunService, (s) => s.removeAdjustment(id(fd)), "Removed"); }
export async function typeAmount(fd: FormData) { return serviceAction(RunService, (s) => s.setTyped(text(fd, "itemId"), text(fd, "code"), num(fd, "amountPaise")), "Amount saved"); }
export async function countWorked(fd: FormData) { return serviceAction(RunService, (s) => s.countWorked(text(fd, "itemId")).then(() => ({ id: text(fd, "itemId") })), "Counted as worked"); }
export async function setDays(fd: FormData) { return serviceAction(RunService, (s) => s.setDays(text(fd, "itemId"), formToObject(fd)), "Days saved"); }

// payouts
export async function markPaid(fd: FormData) { return serviceAction(PayoutService, (s) => s.markPaid(id(fd), { ...formToObject(fd), itemIds: ids(fd).length ? ids(fd) : undefined }).then((r) => ({ paid: r.paid })), "Marked paid"); }
export async function confirmBank(fd: FormData) { return serviceAction(PayoutService, (s) => s.confirmBank(id(fd), text(fd, "itemId")), "New account will be used"); }
export async function markFailed(fd: FormData) { return serviceAction(PayoutService, (s) => s.markFailed(id(fd), { ...formToObject(fd), itemIds: ids(fd) }).then((n) => ({ n })), "Marked failed"); }
export async function retryPayout(fd: FormData) { return serviceAction(PayoutService, (s) => s.retry(id(fd), ids(fd)).then((n) => ({ n })), "Set to try again"); }

// loans
export async function requestLoan(fd: FormData) { return serviceAction(LoanService, (s) => s.request({ ...formToObject(fd), amountPaise: num(fd, "amountPaise"), emiPaise: num(fd, "emiPaise") }).then((r) => ({ id: r.loan.id })), "Loan sent for approval"); }
export async function giveLoan(fd: FormData) { return serviceAction(LoanService, (s) => s.give(id(fd), formToObject(fd)).then((r) => ({ id: r.id })), "Loan given"); }
export async function pauseLoan(fd: FormData) { return serviceAction(LoanService, (s) => s.pause(id(fd), formToObject(fd)).then((r) => ({ id: r.id })), "Loan paused"); }
export async function resumeLoan(fd: FormData) { return serviceAction(LoanService, (s) => s.resume(id(fd)).then((r) => ({ id: r.id })), "Loan resumed"); }
export async function payBackLoan(fd: FormData) { return serviceAction(LoanService, (s) => s.payBack(id(fd), { ...formToObject(fd), amountPaise: fd.get("amountPaise") ? num(fd, "amountPaise") : undefined }), "Payment recorded"); }

// exits
const exitBody = (fd: FormData) => ({ ...formToObject(fd), other: fd.get("other") ? JSON.parse(text(fd, "other")) : [] });
export async function createExit(fd: FormData) { return serviceAction(ExitService, (s) => s.create(exitBody(fd)).then((r) => ({ id: r.id })), "Exit started"); }
export async function updateExit(fd: FormData) { return serviceAction(ExitService, (s) => s.update(id(fd), exitBody(fd)).then((r) => ({ id: r.id })), "Exit updated"); }
export async function addExitLine(fd: FormData) { return serviceAction(ExitService, (s) => s.addLine(id(fd), { ...formToObject(fd), amountPaise: num(fd, "amountPaise") }).then((r) => ({ id: r.id })), "Line added"); }
export async function removeExitLine(fd: FormData) { return serviceAction(ExitService, (s) => s.removeLine(id(fd), num(fd, "index")).then((r) => ({ id: r.id })), "Line removed"); }
export async function submitExit(fd: FormData) { return serviceAction(ExitService, (s) => s.submit(id(fd)).then((r) => ({ id: r.id })), "Sent for approval"); }
export async function undoExit(fd: FormData) { return serviceAction(ExitService, (s) => s.undo(id(fd), formToObject(fd)), "Settlement undone"); }
export async function deleteExit(fd: FormData) { return serviceAction(ExitService, (s) => s.remove(id(fd)), "Exit deleted"); }

// statutory
export async function recordRemittance(fd: FormData) { return serviceAction(RemittanceService, (s) => s.record({ ...formToObject(fd), amountPaise: num(fd, "amountPaise") }).then((r) => ({ id: r.id })), "Payment recorded"); }
export async function overrideRate(fd: FormData) { return serviceAction(RateService, (s) => s.override({ ...formToObject(fd), value: JSON.parse(text(fd, "value")) }), "Rate saved"); }
export async function removeRateOverride(fd: FormData) { return serviceAction(RateService, (s) => s.removeOverride(id(fd)), "Back to the built-in rate"); }
export async function savePayConfig(fd: FormData) { return serviceAction(PayConfigService, (s) => s.save(formToObject(fd)).then(() => ({ id: "config" })), "Payroll settings saved"); }

// me
export async function saveDeclaration(fd: FormData) { return serviceAction(DeclarationService, (s) => s.save(formToObject(fd)).then((r) => ({ id: r.id })), "Declaration saved"); }
export async function acceptDeclaration(fd: FormData) { return serviceAction(DeclarationService, (s) => s.accept(text(fd, "userId"), text(fd, "fy") || undefined).then((id) => ({ id })), "Declaration accepted"); }
export async function sendBackDeclaration(fd: FormData) { return serviceAction(DeclarationService, (s) => s.sendBack(text(fd, "userId"), text(fd, "note"), text(fd, "fy") || undefined).then((id) => ({ id })), "Sent back"); }

// approvals
export async function withdrawRequest(fd: FormData) { return serviceAction(ApprovalDeskService, (s) => s.withdraw(id(fd)).then((r) => ({ id: r.id })), "Request withdrawn"); }
