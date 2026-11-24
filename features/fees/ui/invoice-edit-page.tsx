import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { InvoiceService } from "../service";
import { editorBase } from "./invoice-editor-data";
import { InvoiceEditor } from "./invoice-editor";
import { BackLink, Notice, NoAccess, can } from "./shared";

export const metadata = { title: "Edit draft bill" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "setup")) return <NoAccess what="Editing bills" who="accountants and admins" home="/app/fees" />;
  const { id } = await params;
  const d = await new InvoiceService(ctx).get(id).catch(() => null);
  if (!d) return <><BackLink href="/app/fees/invoices">Bills</BackLink><Notice tone="danger" action={{ href: "/app/fees/invoices", label: "Back to bills" }}>This bill does not exist, or it belongs to another school.</Notice></>;
  const inv = d.invoice;
  if (inv.status !== "draft") return <><BackLink href={`/app/fees/invoices/${id}`}>{inv.number ?? "Bill"}</BackLink><Notice action={inv.status === "issued" ? { href: `/app/fees/invoices/${id}/revise`, label: "Revise this bill" } : { href: `/app/fees/invoices/${id}`, label: "Open the bill" }}>{inv.status === "issued" ? "This bill is issued, so it cannot be edited. Revise it to make a new version." : "This bill is cancelled and cannot be changed."}</Notice></>;
  return (
    <>
      <BackLink href={`/app/fees/invoices/${id}`}>Draft bill</BackLink>
      <PageHeader eyebrow="Fees" title="Edit draft bill" description={`For ${d.student.name}. It saves itself while you type.`} />
      <InvoiceEditor mode="edit" {...(await editorBase(ctx))} student={{ id: d.student.id, label: inv.snapshot.studentName, meta: `${inv.snapshot.admissionNo} · ${inv.snapshot.classLabel}` }}
        invoice={{ id: inv.id, number: inv.number, label: inv.label, dueDate: inv.dueDate, note: inv.note, lines: inv.lines.map((l) => ({ headId: l.headId, label: l.label, amountPaise: l.amountPaise, kind: l.kind })) }} />
    </>
  );
}
