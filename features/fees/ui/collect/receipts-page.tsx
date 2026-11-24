import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import type { Column } from "@smw/ui/shell/DataTable";
import { buttonVariants } from "@smw/ui/ui/button";
import { KeyTotals } from "@smw/ui/finance/KeyTotals";
import { PeriodPicker } from "@smw/ui/finance/PeriodPicker";
import { parsePeriod, periodLabel } from "@smw/ui/finance/logic";
import { METHOD_LABEL } from "../../constants";
import { DuesService, ReceiptService } from "../../service";
import { ReceiptsTable } from "./receipts-table";
import { DeskNav, NoAccess, can, type Search } from "./shared";

export const metadata = { title: "Receipts" };

const columns: Column[] = [
  { key: "number", label: "Receipt", type: "mono" }, { key: "date", label: "Date", type: "date" }, { key: "studentName", label: "Student", type: "person", metaKey: "classLabel" },
  { key: "methods", label: "Paid by", hideOnMobile: true }, { key: "amountPaise", label: "Amount", type: "money" }, { key: "status", label: "State", type: "state" }, { key: "cashier", label: "Cashier", hideOnMobile: true },
];

export default async function ReceiptsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess what="The receipt register" who="accountants, admins and auditors" />;
  const sp = await searchParams, today = todayIST();
  const period = parsePeriod({ period: typeof sp.period === "string" ? sp.period : null, from: typeof sp.from === "string" ? sp.from : null, to: typeof sp.to === "string" ? sp.to : null }, today);
  const q = listQueryFrom(sp);
  const query = { ...q, filters: { ...q.filters, from: period.from, to: period.to } };
  const receipts = new ReceiptService(ctx);
  const [page, cashiers, classes] = await Promise.all([receipts.register(query), receipts.cashiers(), new DuesService(ctx).classOptions()]);
  const csv = new URLSearchParams(Object.entries(query.filters).concat(q.q ? [["q", q.q]] : [])).toString();
  const methods = Object.entries(page.byMethod);

  return (
    <>
      <PageHeader eyebrow="Fees" title="Receipts" description={`Every receipt for ${periodLabel(period)}, with who took it and how.`}
        actions={<>
          <Link href={`/app/fees/receipts/csv?${csv}`} prefetch={false} className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Download CSV</Link>
          {can(ctx, "collect") ? <Link href="/app/fees/collect" className={buttonVariants({ className: "rounded-full" })}>Collect fees</Link> : null}
        </>} />
      <DeskNav ctx={ctx} current="/app/fees/receipts" />
      <div className="mb-5 flex flex-col gap-4"><PeriodPicker today={today} /></div>
      <div className="mb-5"><KeyTotals items={[{ label: "Received", paise: page.totalPaise, strong: true, hint: "Not counting reversed or bounced" }, ...methods.map(([m, paise]) => ({ label: METHOD_LABEL[m as keyof typeof METHOD_LABEL] ?? m, paise }))]} /></div>
      <ReceiptsTable columns={columns} rows={page.rows.map((r) => ({ ...r }))} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/fees/receipts/{id}" searchPlaceholder="Search receipt number or student"
        filters={[
          { key: "method", label: "Method", options: Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label })) },
          { key: "status", label: "State", options: [["valid", "Valid"], ["clearing", "Clearing"], ["bounced", "Bounced"], ["reversed", "Reversed"]].map(([value, label]) => ({ value: value!, label: label! })) },
          { key: "cashier", label: "Cashier", options: cashiers.map((c) => ({ value: c.id, label: c.name })) },
          { key: "classId", label: "Class", options: classes.map((c) => ({ value: c.id, label: c.name })) },
        ]}
        empty={{ title: "No receipts in this period", description: "Try another period or clear the filters. Receipts appear here the moment they are made.", action: can(ctx, "collect") ? <Link href="/app/fees/collect" className={buttonVariants({ className: "rounded-full" })}>Collect the first one</Link> : undefined }} />
    </>
  );
}
