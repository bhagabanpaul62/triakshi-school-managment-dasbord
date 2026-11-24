import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import { ConfirmMoney } from "@smw/ui/finance/ConfirmMoney";
import type { Column } from "@smw/ui/shell/DataTable";
import { OUT_METHODS } from "../constants";
import { PaymentService } from "../service";
import { requestPaymentReversal } from "./actions";
import { PaymentsTable } from "./payments-table";
import { JournalLink, NoAccess, OneRecord, SectionNav, can, one, type Search } from "./shared";

export const metadata = { title: "Payments" };

const columns: Column[] = [
  { key: "number", label: "Voucher", type: "mono" }, { key: "date", label: "Date", type: "date" }, { key: "vendorName", label: "Paid to" }, { key: "billNos", label: "For bills", hideOnMobile: true },
  { key: "method", label: "Method", type: "badge", labels: { bank_transfer: "Bank", upi: "UPI", cash: "Cash", cheque: "Cheque", card: "Card" }, hideOnMobile: true }, { key: "amountPaise", label: "Amount", type: "money" }, { key: "state", label: "State", type: "state" },
];

export default async function PaymentsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess ctx={ctx} what="Payments" who="accountants and admins" />;
  const sp = await searchParams, manage = can(ctx, "manage");
  const page = await new PaymentService(ctx).list(listQueryFrom(sp));
  const rows = page.rows.map((r) => ({ ...r, state: r.status === "reversed" ? "reversed" : r.reversalPending ? "pending" : "valid" }));
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : []))).toString();

  return (
    <>
      <PageHeader eyebrow="Expenses" title="Payments" description="Every payment to a vendor, with its voucher and its entry in the books."
        actions={<>
          <Link href={`/app/expenses/payments/csv${qs ? `?${qs}` : ""}`} prefetch={false} className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Download CSV</Link>
          {manage ? <Link href="/app/expenses/payments/new" className={buttonVariants({ className: "rounded-full" })}>Pay a vendor</Link> : null}
        </>} />
      <SectionNav ctx={ctx} current="/app/expenses/payments" />
      {one(sp.id) ? <OneRecord all="/app/expenses/payments" /> : null}
      <PaymentsTable canManage={manage} columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search voucher, vendor or reference"
        filters={[{ key: "method", label: "Method", options: OUT_METHODS.map((m) => ({ value: m, label: m.replace(/_/g, " ") })) }, { key: "status", label: "State", options: [{ value: "valid", label: "Valid" }, { value: "reversed", label: "Reversed" }] }]}
        rowActions={Object.fromEntries(rows.map((r) => [r.id, (
          <span key={r.id} className="inline-flex flex-wrap items-center justify-end gap-1">
            <Link href={`/app/expenses/payments/${r.id}/voucher`} target="_blank" className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Voucher</Link>
            <Link href={`/app/expenses/vendors/${r.vendorId}`} className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Vendor</Link>
            <JournalLink id={r.journalId} label="Entry" />
            {manage && r.status === "valid" && !r.reversalPending ? <ConfirmMoney label="Reverse" title={`Reverse ${r.number}`} action={requestPaymentReversal} values={{ id: r.id }} amountPaise={r.amountPaise} danger confirmLabel="Ask to reverse"
              consequence="An approver must agree. Then the bills owe this money again and the books are corrected with a mirror entry." successMessage="Sent to an approver" /> : null}
            {r.reversalPending ? <Link href="/app/finance/approvals" className="px-2 text-xs underline underline-offset-4">Waiting for approval</Link> : null}
          </span>
        )]))}
        empty={{ title: "No payments yet", description: "A payment appears here when you pay an approved bill. Vouchers are numbered in order.", action: manage ? <Link href="/app/expenses/payments/new" className={buttonVariants({ className: "rounded-full" })}>Pay a vendor</Link> : undefined }} />
    </>
  );
}
