import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { editorBase } from "./invoice-editor-data";
import { InvoiceEditor } from "./invoice-editor";
import { FeesLookup } from "./lookups";
import { BackLink, NoAccess, Notice, can, one, type Search } from "./shared";

export const metadata = { title: "New bill" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "setup")) return <NoAccess what="Making bills" who="accountants and admins" home="/app/fees" />;
  const sp = await searchParams, sid = one(sp.student);
  const [base, student, hasStudents] = await Promise.all([editorBase(ctx), sid ? new FeesLookup(ctx).studentOption(sid) : null, new FeesLookup(ctx).hasStudents()]);
  return (
    <>
      <BackLink href="/app/fees/invoices">Bills</BackLink>
      <PageHeader eyebrow="Fees" title="New bill" description="An extra charge for one student or a whole class: a trip, a lab fee, a lost book. Regular fees come from the fee plans." />
      {hasStudents ? null : <Notice action={{ href: "/app/students?next=/app/fees/invoices/new", label: "Add students" }}>There are no students yet, so there is nobody to bill. Add students first.</Notice>}
      <InvoiceEditor mode="new" {...base} student={student ?? undefined} />
    </>
  );
}
