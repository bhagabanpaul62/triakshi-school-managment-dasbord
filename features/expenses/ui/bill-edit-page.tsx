import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { BillService, LookupService } from "../service";
import { BackLink, NoAccess, Notice, can } from "./shared";
import { BillForm } from "./bill-form";

export const metadata = { title: "Edit bill" };

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "manage")) return <NoAccess ctx={ctx} what="Editing bills" who="accountants and admins" />;
  const { id } = await params, look = new LookupService(ctx);
  const d = await new BillService(ctx).get(id);
  const back = `/app/expenses/bills?bill=${id}`;
  if (d.bill.status !== "draft" && d.bill.status !== "rejected") {
    return <><BackLink href={back}>Bill {d.bill.billNo}</BackLink><Notice action={{ href: back, label: "Open the bill" }}>{d.bill.status === "pending" ? "This bill is waiting for approval. Withdraw it from the bill page to change it." : "Only drafts and rejected bills can be edited. An approved bill is cancelled and entered again."}</Notice></>;
  }
  const [accounts, centres, vehicles] = await Promise.all([look.accounts(), look.centres(), look.vehicles()]);
  return (
    <>
      <BackLink href={back}>Bill {d.bill.billNo}</BackLink>
      <PageHeader eyebrow="Expenses" title={d.bill.status === "rejected" ? "Edit and resend" : "Edit draft"} description={d.vendor.name} />
      {d.bill.status === "rejected" ? <Notice tone="danger">Not approved: {d.approval?.note ?? "no reason was written"}. Fix it, then use "Save and send for approval".</Notice> : null}
      <BillForm accounts={accounts} centres={centres} vehicles={vehicles} today={todayIST()} vendor={{ id: d.vendor.id, label: d.vendor.name }}
        bill={{ id, billNo: d.bill.billNo, billDate: d.bill.billDate, dueDate: d.bill.dueDate, note: d.bill.note, fileName: d.bill.fileName, lines: d.lines }} />
    </>
  );
}
