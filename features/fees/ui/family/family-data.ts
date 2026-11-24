import type { Ctx } from "@smw/feature-kit";
import { DuesService } from "../../dues";

type Account = Awaited<ReturnType<DuesService["studentAccount"]>>;

/** Everything a student login sees of its money: each child's account, and the bills that can be paid today. */
export async function loadFamily(ctx: Ctx) {
  const dues = new DuesService(ctx);
  const rows = await dues.mine();
  const kids = await Promise.all(rows.map(async (r) => ({ id: r.id, name: r.name, admissionNo: r.admissionNo, classLabel: r.classLabel, account: await dues.studentAccount(r.id) })));
  const bills = kids.flatMap((k) => k.account.invoices.filter((i) => i.status === "issued" && i.openPaise > 0).map((i) => ({
    id: i.id, kidId: k.id, kid: k.name, admissionNo: k.admissionNo, number: i.number, label: i.label, dueDate: i.dueDate, state: i.state, openPaise: i.openPaise, latePaise: i.accruedLatePaise,
  }))).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const duePaise = bills.reduce((s, b) => s + b.openPaise + b.latePaise, 0);
  return { kids, bills, duePaise, next: bills[0] ?? null };
}
export type FamilyData = Awaited<ReturnType<typeof loadFamily>>;
export type { Account };
