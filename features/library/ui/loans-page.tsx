import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import Link from "next/link";
import { buttonVariants } from "@smw/ui/ui/button";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FINE_PER_DAY_PAISE } from "../rules";
import { LoanService } from "../service";
import { returnLoan, waiveFine } from "./actions";
import { returnConfirm } from "./return-confirm";

export const metadata = { title: "Loans" };

const columns: Column[] = [
  { key: "title", label: "Book" },
  { key: "borrowerName", label: "Borrower", type: "person", metaKey: "borrowerMeta" },
  { key: "issuedOn", label: "Issued", type: "date", hideOnMobile: true },
  { key: "dueOn", label: "Due", type: "date" },
  { key: "returnedOn", label: "Returned", type: "date", hideOnMobile: true },
  { key: "status", label: "Status", type: "badge", labels: { open: "Out", overdue: "Overdue", returned: "Returned" }, tones: { open: "info", overdue: "danger" } },
  { key: "fine", label: "Fine", type: "money" },
];

export default async function LoansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new LoanService(ctx);
  const page = await svc.list(listQueryFrom(await searchParams));
  const canManage = svc.can("manage");
  const rows = page.rows.map((r) => ({ ...r, fine: r.finePaise || null, borrowerMeta: [r.classLabel ?? r.borrowerMeta, r.status === "overdue" ? r.chasePhone : null].filter(Boolean).join(" · ") }));

  return (
    <>
      <PageHeader eyebrow="Library" title="Loans" description={`Every book lent, with due dates and late fines (₹${FINE_PER_DAY_PAISE / 100} a day). Overdue rows show the parent's number.`} />
      <DataTable
        columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount}
        searchPlaceholder="Search book or borrower"
        filters={[
          { key: "status", label: "Status", options: [{ value: "open", label: "Out" }, { value: "overdue", label: "Overdue" }, { value: "returned", label: "Returned" }] },
          { key: "kind", label: "Borrower", options: [{ value: "student", label: "Students" }, { value: "staff", label: "Staff" }] },
        ]}
        empty={{ title: "No loans match.", description: "Issue a book from the Library page and it shows up here.", action: <Link href="/app/library" className={buttonVariants({ className: "rounded-full" })}>Go to the issue desk</Link> }}
        rowActions={canManage ? Object.fromEntries(rows.map((r) => [r.id, (
          <span key={r.id} className="inline-flex items-center gap-1">
            {r.finePaise > 0 ? <ActionButton label="Waive fine" variant="ghost" action={waiveFine} values={{ id: r.id }}
              confirm={{ title: "Waive this fine?", body: `${r.borrowerName} will not be charged for ${r.title}.`, confirmLabel: "Waive fine" }} /> : null}
            {!r.returnedOn ? <ActionButton label="Return" variant="secondary" action={returnLoan} values={{ id: r.id }} confirm={returnConfirm(r)} /> : null}
          </span>
        )])) : undefined}
      />
    </>
  );
}
