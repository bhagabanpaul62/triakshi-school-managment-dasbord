import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { openOf } from "../calc";
import { InvoiceService } from "../service";
import { editorBase } from "./invoice-editor-data";
import { InvoiceEditor } from "./invoice-editor";
import { BackLink, Notice, NoAccess, can, one, type Search } from "./shared";

export const metadata = { title: "Revise bill" };

export default async function ReviseInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "setup")) return <NoAccess what="Revising bills" who="accountants and admins" home="/app/fees" />;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const d = await new InvoiceService(ctx).get(id).catch(() => null);
  if (!d) return <><BackLink href="/app/fees/invoices">Bills</BackLink><Notice tone="danger" action={{ href: "/app/fees/invoices", label: "Back to bills" }}>This bill does not exist, or it belongs to another school.</Notice></>;
  const inv = d.invoice, back = `/app/fees/invoices/${id}`;
  if (inv.status !== "issued") return <><BackLink href={back}>Bill</BackLink><Notice action={inv.status === "draft" ? { href: `${back}/edit`, label: "Edit the draft" } : { href: back, label: "Open the bill" }}>{inv.status === "draft" ? "A draft is edited, not revised." : "A cancelled bill cannot be revised."}</Notice></>;
  if (d.openChange) return <><BackLink href={back}>{inv.number}</BackLink><Notice tone="info" action={{ href: back, label: "Open the bill" }}>A request on this bill is waiting for approval. Withdraw it or wait for the decision before revising again.</Notice></>;
  if (d.openPaise <= 0) return <><BackLink href={back}>{inv.number}</BackLink><Notice action={{ href: back, label: "Open the bill" }}>Nothing is open on this bill, so there is nothing to revise.</Notice></>;
  // A refused revision comes back with what was asked, to fix and send again.
  const again = d.changes.find((c) => c.id === one(sp.change) && c.kind === "revise" && c.status === "rejected" && !c.direct);
  const p = (again?.payload ?? {}) as { lines?: { headId?: string; kind?: string; label: string; amountPaise: number }[]; reason?: string; label?: string; dueDate?: string };
  const lines = p.lines?.length ? p.lines.map((l) => ({ headId: l.headId ?? null, label: l.label, amountPaise: l.amountPaise, kind: l.kind ?? "fee" }))
    : inv.lines.filter((l) => l.kind !== "late" && openOf(l) > 0).map((l) => ({ headId: l.headId, label: l.label, amountPaise: openOf(l), kind: l.kind }));
  return (
    <>
      <BackLink href={back}>{inv.number}</BackLink>
      <PageHeader eyebrow="Fees" title={`Revise ${inv.number}`} description="Change what is still open. The old bill stays on file and the new version is linked to it." />
      <InvoiceEditor mode="revise" {...(await editorBase(ctx))} canGroup={false} student={{ id: d.student.id, label: inv.snapshot.studentName, meta: `${inv.snapshot.admissionNo} · ${inv.snapshot.classLabel}` }}
        invoice={{ id: inv.id, number: inv.number, label: p.label ?? inv.label, dueDate: p.dueDate ?? inv.dueDate, note: null, lateRule: inv.lateRule, lines }}
        revise={{ oldLines: inv.lines.map((l) => ({ label: l.label, amountPaise: l.amountPaise, concessionPaise: l.concessionPaise, creditedPaise: l.creditedPaise, paidPaise: l.paidPaise })), changeId: again?.id, reason: p.reason }} />
    </>
  );
}
