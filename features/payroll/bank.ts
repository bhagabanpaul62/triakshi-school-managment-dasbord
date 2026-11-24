// The bank account a run was approved with. Payouts and the bank file use this, not whatever the profile says later.
import { unseal } from "@smw/feature-kit/secret";
import type { ItemRow } from "./compute";
import type { payProfiles } from "./schema";

type Profile = typeof payProfiles.$inferSelect;
export interface BankSnap { payBy: "bank" | "cash" | "cheque"; sealed: string | null; last4: string | null; ifsc: string | null; bankName: string | null }

/** How a person is paid right now. */
export const bankOf = (p: Profile | null | undefined): BankSnap => ({ payBy: p?.payBy ?? "bank", sealed: p?.bankSealed ?? null, last4: p?.bankLast4 ?? null, ifsc: p?.ifsc ?? null, bankName: p?.bankName ?? null });

/** What was frozen at approval; a run approved before this existed has none, so the live details stand in. */
export const frozenBank = (i: ItemRow, live: Profile | null | undefined): BankSnap => (i.snapshot as { bank?: BankSnap }).bank ?? bankOf(live);

const same = (a: BankSnap, b: BankSnap, schoolId: string) => a.payBy === b.payBy && a.ifsc === b.ifsc && (a.sealed === b.sealed || (!!a.sealed && !!b.sealed && unseal(a.sealed, schoolId) === unseal(b.sealed, schoolId)));

/** The live details when they differ from the frozen ones, else null. */
export function movedBank(i: ItemRow, live: Profile | null | undefined, schoolId: string): BankSnap | null {
  const now = bankOf(live);
  return same(frozenBank(i, live), now, schoolId) ? null : now;
}

/** "was ••••1234, now ••••9876" for a message or the audit log; never more than the last four. */
export const describeMove = (was: BankSnap, now: BankSnap) => {
  const show = (b: BankSnap) => (b.payBy === "bank" ? `bank ••••${b.last4 ?? "none"}` : b.payBy);
  return `was ${show(was)}, now ${show(now)}`;
};
