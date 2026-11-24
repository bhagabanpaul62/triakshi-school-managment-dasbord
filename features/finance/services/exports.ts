// The lists that have a CSV or PDF link (accounts, journals, approvals), as the same Report the statements use, so one writer makes every file.
import type { Page } from "@smw/feature-kit";
import { ACCOUNT_TYPE_LABEL, JOURNAL_KIND_LABEL, kindLabel } from "../ui/labels";
import type { AccountWithBalance } from "./accounts";
import type { JournalRow } from "./journals";
import type { Approval } from "../approvals";
import type { Report } from "./report";

/** Every page of a paged list, up to a cap, for an export. */
export async function allPages<T>(fetch: (page: number) => Promise<Page<T>>, maxRows = 20_000): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const p = await fetch(page);
    out.push(...p.rows);
    if (page >= p.pageCount || out.length >= maxRows) return out.slice(0, maxRows);
  }
}

export const accountsReport = (rows: AccountWithBalance[]): Report => ({
  title: "Chart of accounts", subtitle: "Balance is shown in the usual direction of each account: assets and expenses by debits, the rest by credits.",
  columns: [{ key: "code", label: "Code", kind: "mono" }, { key: "name", label: "Account" }, { key: "type", label: "Type" }, { key: "group", label: "Group" }, { key: "status", label: "Status" }, { key: "balance", label: "Balance", kind: "money" }],
  rows: rows.map((a) => ({ cells: { code: a.code, name: a.name, type: ACCOUNT_TYPE_LABEL[a.type], group: a.group, status: a.isActive ? "In use" : "Off", balance: a.shownPaise }, links: { name: `/app/finance/accounts/${a.id}` } })),
});

export const journalsReport = (rows: JournalRow[], subtitle: string): Report => ({
  title: "Journal entries", subtitle,
  columns: [{ key: "date", label: "Date", kind: "date" }, { key: "number", label: "Entry", kind: "mono" }, { key: "memo", label: "Narration" }, { key: "kind", label: "Kind" }, { key: "amount", label: "Amount", kind: "money" }],
  rows: rows.map((j) => ({ cells: { date: j.date, number: j.number, memo: j.memo, kind: JOURNAL_KIND_LABEL[j.kind as keyof typeof JOURNAL_KIND_LABEL] ?? j.kind, amount: j.totalPaise }, links: { number: `/app/finance/journals/${j.id}` } })),
});

export const approvalsReport = (rows: (Approval & { requestedByName: string | null; decidedByName: string | null })[], subtitle: string): Report => ({
  title: "Approvals", subtitle,
  columns: [{ key: "date", label: "Asked on", kind: "date" }, { key: "kind", label: "Kind" }, { key: "title", label: "Request" }, { key: "by", label: "Asked by" }, { key: "status", label: "Status" }, { key: "decidedBy", label: "Decided by" }, { key: "note", label: "Note" }, { key: "amount", label: "Amount", kind: "money" }],
  rows: rows.map((a) => ({ cells: { date: a.createdAt.toISOString().slice(0, 10), kind: kindLabel(a.kind), title: a.title, by: a.requestedByName ?? "", status: a.status, decidedBy: a.decidedByName ?? "", note: a.note ?? "", amount: a.amountPaise } })),
});
