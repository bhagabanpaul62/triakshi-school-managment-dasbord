"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { AccountService, CashAccountService, CostCentreService, JournalService, PeriodService, SeriesService, SettingsService } from "../service";

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
