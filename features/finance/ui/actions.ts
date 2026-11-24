"use server";

import { ValidationError } from "@smw/feature-kit";
import { formToObject, serviceAction } from "@smw/runtime";
import { AccountService, ApprovalDeskService, BankService, CashAccountService, CostCentreService, JournalService, PeriodService, SeriesService, SettingsService } from "../service";

const id = (fd: FormData) => String(fd.get("id"));
const on = (fd: FormData) => fd.get("active") === "1";
/** The journal editor posts its lines as one JSON `payload`. */
const payload = (fd: FormData) => JSON.parse(String(fd.get("payload") ?? "{}")) as unknown;

export async function createAccount(fd: FormData) { return serviceAction(AccountService, (s) => s.create(formToObject(fd)), "Account added"); }
export async function updateAccount(fd: FormData) { return serviceAction(AccountService, (s) => s.update(id(fd), formToObject(fd)), "Account updated"); }
export async function deleteAccount(fd: FormData) { return serviceAction(AccountService, (s) => s.remove(id(fd)), "Account deleted"); }
export async function setAccountActive(fd: FormData) { return serviceAction(AccountService, (s) => s.setActive(id(fd), on(fd)), on(fd) ? "Account switched on" : "Account switched off"); }

export async function proposeJournal(fd: FormData) { return serviceAction(JournalService, (s) => s.propose(payload(fd)).then((r) => ({ id: r.approvalId })), "Sent for approval"); }
export async function requestReversal(fd: FormData) { return serviceAction(JournalService, (s) => s.requestReversal(id(fd), formToObject(fd)).then((r) => ({ id: r.approvalId })), "Sent for approval"); }

export async function transfer(fd: FormData) { return serviceAction(CashAccountService, (s) => s.transfer(formToObject(fd)).then((r) => ({ id: r.journalId })), "Money moved"); }
export async function setOpening(fd: FormData) { return serviceAction(CashAccountService, (s) => s.setOpening(formToObject(fd)).then((r) => ({ id: r.journalId })), "Opening balance set"); }
export async function createCashAccount(fd: FormData) { return serviceAction(CashAccountService, (s) => s.create(formToObject(fd)), "Account added"); }
export async function updateCashAccount(fd: FormData) { return serviceAction(CashAccountService, (s) => s.update(id(fd), formToObject(fd)), "Account updated"); }
export async function setDefaultCashAccount(fd: FormData) { return serviceAction(CashAccountService, (s) => s.setDefault(id(fd)), "Default changed"); }
export async function setCashAccountActive(fd: FormData) { return serviceAction(CashAccountService, (s) => s.setActive(id(fd), on(fd)), on(fd) ? "Account switched on" : "Account switched off"); }

export async function saveSettings(fd: FormData) { return serviceAction(SettingsService, (s) => s.update(formToObject(fd)), "Finance rules saved"); }
export async function editSeries(fd: FormData) { return serviceAction(SeriesService, (s) => s.edit(String(fd.get("key")), formToObject(fd)), "Numbering saved"); }

const month = (fd: FormData) => String(fd.get("month"));
export async function softClosePeriod(fd: FormData) { return serviceAction(PeriodService, (s) => s.softClose(month(fd)), "Month soft closed"); }
export async function closePeriod(fd: FormData) { return serviceAction(PeriodService, (s) => s.close(month(fd)), "Month closed"); }
export async function reopenPeriod(fd: FormData) { return serviceAction(PeriodService, (s) => s.reopen(month(fd), formToObject(fd)), "Month reopened"); }

export async function createCostCentre(fd: FormData) { return serviceAction(CostCentreService, (s) => s.create(formToObject(fd)), "Cost centre added"); }
export async function updateCostCentre(fd: FormData) { return serviceAction(CostCentreService, (s) => s.update(id(fd), formToObject(fd)), "Cost centre updated"); }
export async function deleteCostCentre(fd: FormData) { return serviceAction(CostCentreService, (s) => s.remove(id(fd)), "Cost centre deleted"); }
export async function setCostCentreActive(fd: FormData) { return serviceAction(CostCentreService, (s) => s.setActive(id(fd), on(fd)), on(fd) ? "Cost centre switched on" : "Cost centre switched off"); }

export async function withdrawRequest(fd: FormData) { return serviceAction(ApprovalDeskService, (s) => s.withdraw(id(fd)).then((r) => ({ id: r.id })), "Request withdrawn"); }

/** The uploaded sheet as the service reads it. */
async function sheet(fd: FormData) {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) throw new ValidationError({ file: "Choose the statement file first." });
  return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
}
export async function checkBankImport(fd: FormData) { return serviceAction(BankService, async (s) => s.previewImport(await sheet(fd), formToObject(fd))); }
export async function importBankStatement(fd: FormData) { return serviceAction(BankService, async (s) => s.commitImport(await sheet(fd), formToObject(fd))); }
export async function autoMatchBank(fd: FormData) { return serviceAction(BankService, (s) => s.autoMatch(String(fd.get("cashAccountId"))).then((r) => ({ id: String(fd.get("cashAccountId")), ...r })), "Matching done"); }
export async function matchBankLine(fd: FormData) { return serviceAction(BankService, (s) => s.match(String(fd.get("bankLineId")), fd.getAll("entry").map(String)).then((r) => ({ id: r.bankLineId })), "Matched"); }
export async function unmatchBankLine(fd: FormData) { return serviceAction(BankService, (s) => s.unmatch(String(fd.get("bankLineId"))).then((r) => ({ id: r.bankLineId })), "Unmatched"); }
export async function createBankEntry(fd: FormData) {
  const r = await serviceAction(BankService, (s) => s.createEntry(String(fd.get("bankLineId")), formToObject(fd)).then((e) => ({ id: e.bankLineId, pending: !!e.approvalId })), "Recorded and matched");
  return r.ok && r.data.pending ? { ...r, message: "Sent for approval. The line is matched once it is approved." } : r;
}
