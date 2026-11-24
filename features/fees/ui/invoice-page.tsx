import Link from "next/link";
import { notFound } from "next/navigation";
import { canApprove } from "@smw/feature-finance/approvals";
import { defaultConfig, applyHidden } from "@smw/feature-finance/templates/config";
import { TemplateService } from "@smw/feature-finance/templates/service";
import { requireCtx } from "@smw/runtime";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ConfirmMoney } from "@smw/ui/finance/ConfirmMoney";
import { DocumentPaper } from "@smw/ui/finance/DocumentPaper";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { StatusTrack, type TrackStep } from "@smw/ui/finance/StatusTrack";
import { shortDate } from "@smw/ui/format";
import { openOf } from "../calc";
import { HeadService, InvoiceService } from "../service";
import { cancelInvoice, deleteInvoiceDraft, issueInvoice, remindOne, withdrawInvoiceChange, withdrawNote } from "./actions";
import { CopyHref } from "./copy-href";
import { invoicePaperData, paperConfig } from "./logic";
import { FeesLookup, type ApprovalInfo } from "./lookups";
import { NoteDialog } from "./note-dialog";
import { BackLink, JournalLink, Notice, PillLink, can } from "./shared";
import { CARD, H3, MUTED } from "./styles";

type Detail = Awaited<ReturnType<InvoiceService["get"]>>;
const KIND: Record<string, string> = { plan: "From a plan", transport: "Transport", library_fine: "Library fine", custom: "Extra charge", opening: "Opening balance", bounce: "Bounce charge" };

function track(d: Detail): TrackStep[] {
  const inv = d.invoice, paid = d.state === "paid", part = d.state === "part_paid" || (inv.paidPaise > 0 && !paid);
  if (inv.status === "cancelled") return [{ label: "Drafted", state: "done" }, { label: "Issued", state: "done", at: inv.issueDate }, { label: "Cancelled", state: "failed", at: inv.cancelledAt?.toISOString().slice(0, 10) }];
  return [
    { label: "Drafted", state: inv.status === "draft" ? "now" : "done" },
    { label: "Issued", state: inv.status === "draft" ? "todo" : paid || part ? "done" : "now", at: inv.issueDate },
    { label: part && !paid ? "Part paid" : "Paid", state: paid ? "done" : part ? "now" : "todo" },
  ];
}

async function templateConfig(ctx: Awaited<ReturnType<typeof requireCtx>>) {
  try { return (await new TemplateService(ctx).current("invoice")).config; } catch { return defaultConfig("invoice", []); }
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="flex justify-between gap-4 py-1 text-sm"><dt className="text-[var(--ds-on-surface-muted)]">{k}</dt><dd className="min-w-0 text-right">{children}</dd></div>;

function ApprovalNote({ a }: { a: ApprovalInfo | undefined }) {
  if (!a) return null;
  if (a.status === "rejected") return <span className="text-[var(--ds-color-danger-400)]">Not approved{a.decidedByName ? ` by ${a.decidedByName}` : ""}: {a.note ?? "no reason was written"}</span>;
  if (a.status === "pending") return <span className="text-[var(--ds-color-warning-400)]">Waiting for {a.waitingFor.length ? a.waitingFor.join(" or ") : "an admin"} to approve.</span>;
  return null;
}

/** One bill: the document beside what it is, what was paid on it, and the one next step. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <Notice tone="danger" action={{ href: "/app/fees", label: "Back to fees" }}>Bills are for the accounts team.</Notice>;
  const { id } = await params;
  let d: Detail;
  try { d = await new InvoiceService(ctx).get(id); } catch { return notFound(); }
  const { invoice: inv, student, notes, allocations, versions, openChange, changes } = d;
  const setup = can(ctx, "setup"), concede = can(ctx, "concede"), collect = can(ctx, "collect");
  const lookup = new FeesLookup(ctx);
  const [config, approvals, journals, heads] = await Promise.all([
    templateConfig(ctx),
    lookup.approvals(["fees.invoice_change", "fees.note"], [...changes.map((c) => c.id), ...notes.map((n) => n.id)]),
    lookup.journalIds([`fees:invoice:${inv.id}`]),
    concede ? new HeadService(ctx).options() : Promise.resolve([]),
  ]);
  const journalId = journals.get(`fees:invoice:${inv.id}`) ?? null;

  const draft = inv.status === "draft", issued = inv.status === "issued", cancelled = inv.status === "cancelled";
  const net = inv.grossPaise - inv.concessionPaise - inv.creditedPaise + inv.latePaise;
  const clean = issued && inv.paidPaise === 0 && inv.creditedPaise === 0 && !inv.parts.length;
  const lastChange = changes.find((c) => !c.direct);
  const lastApproval = lastChange ? approvals.get(lastChange.id) : undefined;
  const replacedBy = versions.find((v) => v.version > inv.version && v.status !== "cancelled");
  const openLines = inv.lines.filter((l) => openOf(l) > 0).map((l) => ({ id: l.id, label: l.label, openPaise: openOf(l) }));
  const receipts = [...allocations.reduce((m, a) => {
    const key = a.receiptId ?? "advance", cur = m.get(key) ?? { id: a.receiptId, number: a.receiptNumber, date: a.date, paise: 0, undone: 0 };
    if (a.undoneAt) cur.undone += a.amountPaise; else cur.paise += a.amountPaise;
    return m.set(key, cur);
  }, new Map<string, { id: string | null; number: string | null; date: string; paise: number; undone: number }>()).values()];

  const data = applyHidden(config, invoicePaperData({
    number: inv.number, issueDate: inv.issueDate, dueDate: inv.dueDate, label: inv.label, student: inv.snapshot, note: inv.note,
    lines: inv.lines.map((l) => l.kind === "late" ? { label: l.label, amountPaise: 0, concessionPaise: 0, latePaise: l.amountPaise } : { label: l.label, amountPaise: l.amountPaise, concessionPaise: l.concessionPaise + l.creditedPaise }),
    marks: cancelled ? ["CANCELLED"] : issued && d.state === "paid" ? ["PAID"] : [],
  }));
  const shown = paperConfig({ ...config, watermark: draft ? "DRAFT" : config.watermark });

  return (
    <>
      <BackLink href="/app/fees/invoices">Bills</BackLink>
      <PageHeader eyebrow={KIND[inv.kind] ?? "Bill"} title={inv.number ?? "Draft bill"} description={`${inv.label} for ${student.name}${inv.version > 1 ? `, version ${inv.version}` : ""}`}
        actions={<><StateBadge state={d.state} /><Link href={`/app/fees/students/${student.id}`} className="text-sm underline underline-offset-4">{student.name}'s fees</Link></>} />

      {openChange ? (
        <Notice tone="info" action={canApprove(ctx) ? { href: "/app/finance/approvals", label: "Open approvals" } : undefined}>
          Waiting for {approvals.get(openChange.id)?.waitingFor.join(" or ") || "an admin"} to approve: {openChange.kind === "cancel" ? "cancel this bill" : "revise this bill"} ({openChange.reason}). The bill stays as it is until then.
        </Notice>
      ) : null}
      {lastChange && lastChange.status === "rejected" && !openChange ? (
        <Notice tone="danger" action={setup && lastChange.kind === "revise" && issued ? { href: `/app/fees/invoices/${inv.id}/revise?change=${lastChange.id}`, label: "Edit and resend" } : undefined}>
          Your request to {lastChange.kind === "cancel" ? "cancel" : "revise"} this bill was <ApprovalNote a={lastApproval} />
        </Notice>
      ) : null}
      {cancelled ? <Notice tone="info" action={replacedBy ? { href: `/app/fees/invoices/${replacedBy.id}`, label: "Open the new version" } : undefined}>Cancelled{inv.cancelReason ? `: ${inv.cancelReason}` : ""}. {replacedBy ? "A new version replaced it." : "Nothing is owed on it. Make a new bill if it was cancelled by mistake."}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <section aria-label="The bill as it prints" className="min-w-0 rounded-3xl bg-[var(--ds-surface-container-low)] p-3 sm:p-5">
          <DocumentPaper config={shown} data={data} kind="invoice" />
          <p className={`${MUTED} mt-3 text-center`}>{draft ? "A draft has no number and no file. Issue it to print." : "This is the on-screen copy. Print gives the school's PDF layout."}</p>
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          <div className={CARD}>
            <StatusTrack steps={track(d)} label="Where this bill stands" />
            <dl className="mt-5 divide-y divide-white/[0.06]">
              <Row k="Student"><Link href={`/app/fees/students/${student.id}`} className="underline underline-offset-4">{inv.snapshot.studentName}</Link> <span className={MUTED}>{inv.snapshot.admissionNo} · {inv.snapshot.classLabel}</span></Row>
              <Row k="Due">{shortDate(inv.dueDate)}</Row>
              {inv.issueDate ? <Row k="Issued">{shortDate(inv.issueDate)}</Row> : null}
              <Row k="Billed"><Money paise={inv.grossPaise} /></Row>
              {inv.concessionPaise + inv.creditedPaise ? <Row k="Concession and credit"><Money paise={-(inv.concessionPaise + inv.creditedPaise)} /></Row> : null}
              {inv.latePaise ? <Row k="Late fee added"><Money paise={inv.latePaise} /></Row> : null}
              <Row k="Paid"><Money paise={inv.paidPaise} /></Row>
              <Row k={issued ? "Still open" : "Total"}><Money paise={issued ? d.openPaise : net} size="lg" tone={d.state === "overdue" ? "danger" : "default"} /></Row>
              {d.accruedLatePaise ? <Row k="Late fee building up"><Money paise={d.accruedLatePaise} tone="warning" /></Row> : null}
            </dl>
            {d.accruedLatePaise ? <p className={`${MUTED} mt-2`}>This is added to the bill when the family pays, by the school's late fee rule.</p> : null}
            {inv.parts.length ? <p className={`${MUTED} mt-2`}>Settlement: {inv.parts.map((p) => `${shortDate(p.dueOn)} (${(p.amountPaise / 100).toLocaleString("en-IN")})`).join(", ")}</p> : null}
          </div>

          <div className={CARD}>
            <h2 className={H3}>Next step</h2>
            <div className="flex flex-wrap items-center gap-2">
              {draft && setup ? <>
                <PillLink href={`/app/fees/invoices/${inv.id}/edit`}>Edit draft</PillLink>
                <ConfirmMoney label="Issue bill" title="Issue this bill" action={issueInvoice} values={{ id: inv.id }} amountPaise={net} reason={false} consequence="It gets its number, goes on the student's dues and is posted to the books." confirmLabel="Issue" successMessage="Bill issued" />
                <ActionButton label="Delete draft" variant="ghost" action={deleteInvoiceDraft} values={{ id: inv.id }} redirectTo="/app/fees/invoices" confirm={{ title: "Delete this draft?", body: "Nothing was posted, so nothing else changes. A draft has no number.", danger: true, confirmLabel: "Delete" }} />
              </> : null}
              {draft && !setup ? <p className="text-sm text-[var(--ds-on-surface-muted)]">This draft waits for an accountant or admin to issue it.</p> : null}
              {issued && d.openPaise > 0 && collect ? <PillLink href={`/app/fees/collect?student=${student.id}`} primary>Collect {`₹${(d.openPaise / 100).toLocaleString("en-IN")}`}</PillLink> : null}
              {issued && d.openPaise > 0 && !collect ? <p className="text-sm text-[var(--ds-on-surface-muted)]">Fees are collected by the cashier or accountant.</p> : null}
              {issued && d.openPaise === 0 ? (receipts.find((r) => r.id) ? <PillLink href={`/app/fees/receipts/${receipts.find((r) => r.id)!.id}`} primary>Open the receipt</PillLink> : <p className="text-sm text-[var(--ds-on-surface-muted)]">Paid in full from advance or deposit.</p>) : null}
              {issued && setup && !openChange && d.openPaise > 0 ? <PillLink href={`/app/fees/invoices/${inv.id}/revise`}>Revise</PillLink> : null}
              {issued && concede && d.openPaise > 0 ? <NoteDialog invoiceId={inv.id} kind="credit" label="Credit note" lines={openLines} heads={[]} /> : null}
              {issued && concede ? <NoteDialog invoiceId={inv.id} kind="debit" label="Debit note" lines={[]} heads={heads.filter((h) => h.isActive).map((h) => ({ id: h.id, name: h.name }))} /> : null}
              {issued && setup && clean && !openChange ? <ConfirmMoney label="Cancel bill" title="Cancel this bill" action={cancelInvoice} values={{ id: inv.id }} amountPaise={d.openPaise} danger confirmLabel="Cancel bill" successMessage="Done" consequence="It comes off what the student owes and its entry in the books is undone with a mirror entry. A cancel that takes off a lot waits for an approver." /> : null}
              {issued && collect && d.openPaise > 0 ? <ActionButton label="Send reminder" variant="ghost" action={remindOne} values={{ studentId: student.id }} successMessage="Reminder sent to the family" /> : null}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
              {!draft ? <a href={`/app/fees/invoices/${inv.id}/file`} target="_blank" rel="noopener" className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm font-medium hover:bg-white/[0.12]">Print</a> : null}
              <CopyHref path={`/app/fees/invoices/${inv.id}`} />
              <JournalLink id={journalId} />
            </div>
            <p className={`${MUTED} mt-3`}>
              {draft ? "A draft can be edited until it is issued."
                : cancelled ? "A cancelled bill cannot be changed. Make a new bill for the student."
                : clean ? "An issued bill is never edited. Revise it (a new version) or cancel it."
                : "Money was paid or credited, so it cannot be cancelled. Use a credit note, or revise it: the open part is credited and a new version issued. A receipt is reversed from the receipt page."}
            </p>
          </div>
        </div>
      </div>

      <section className={`${CARD} mt-6`} aria-label="Lines">
        <h2 className={H3}>Lines</h2>
        <div className="custom-scrollbar overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs text-[var(--ds-on-surface-muted)]"><th className="py-2 font-normal">Line</th><th className="py-2 text-right font-normal">Billed</th><th className="py-2 text-right font-normal">Concession</th><th className="py-2 text-right font-normal">Credit</th><th className="py-2 text-right font-normal">Paid</th><th className="py-2 text-right font-normal">Open</th></tr></thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.id} className="border-t border-white/[0.06]"><td className="py-2">{l.label}{l.kind === "late" ? <span className={`${MUTED} ml-2`}>late fee</span> : l.kind === "deposit" ? <span className={`${MUTED} ml-2`}>refundable deposit</span> : null}</td>
                  <td className="py-2 text-right"><Money paise={l.amountPaise} /></td><td className="py-2 text-right"><Money paise={l.concessionPaise || null} /></td><td className="py-2 text-right"><Money paise={l.creditedPaise || null} /></td>
                  <td className="py-2 text-right"><Money paise={l.paidPaise || null} /></td><td className="py-2 text-right"><Money paise={issued ? openOf(l) : null} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className={CARD} aria-label="Receipts">
          <h2 className={H3}>Receipts</h2>
          {receipts.length ? (
            <ul className="divide-y divide-white/[0.06] text-sm">
              {receipts.map((r) => (
                <li key={r.id ?? "advance"} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  {r.id ? <Link href={`/app/fees/receipts/${r.id}`} className="underline underline-offset-4">{r.number}</Link> : <span>Advance or deposit used</span>}
                  <span className={MUTED}>{shortDate(r.date)}</span>
                  <span className="flex items-center gap-2">{r.undone ? <StateBadge state="reversed" /> : null}<Money paise={r.paise || r.undone} /></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">{issued ? "Nothing paid yet." : "Receipts appear once the bill is issued and paid."}</p>}
        </section>

        <section className={CARD} aria-label="Versions">
          <h2 className={H3}>Versions</h2>
          <ul className="divide-y divide-white/[0.06] text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                {v.id === inv.id ? <span className="font-medium">{v.number ?? "Draft"} (this one)</span> : <Link href={`/app/fees/invoices/${v.id}`} className="underline underline-offset-4">{v.number ?? "Draft"}</Link>}
                <span className={MUTED}>Version {v.version}</span><StateBadge state={v.status === "issued" ? "valid" : v.status} />
              </li>
            ))}
          </ul>
          {versions.length < 2 ? <p className={`${MUTED} mt-2`}>A revision keeps the old bill on file and links the new one here.</p> : null}
        </section>
      </div>

      <section className={`${CARD} mt-6`} aria-label="Credit and debit notes">
        <h2 className={H3}>Credit and debit notes</h2>
        {notes.length ? (
          <ul className="divide-y divide-white/[0.06] text-sm">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="min-w-0"><span className="block">{n.number ?? "Waiting"} · {n.kind === "credit" ? "Credit" : "Debit"} ({n.reasonType.replace("_", " ")})</span><span className={`${MUTED} block`}>{n.reason}{n.status !== "approved" ? <> · <ApprovalNote a={approvals.get(n.id)} /></> : ""}</span></span>
                <span className="flex items-center gap-2"><StateBadge state={n.status} /><Money paise={n.kind === "credit" ? -n.amountPaise : n.amountPaise} />
                  {n.status === "pending" && concede ? <ActionButton label="Withdraw" variant="ghost" action={withdrawNote} values={{ id: n.id }} confirm={{ title: "Take this request back?", body: "The bill stays as it is. You can send a new note later.", confirmLabel: "Withdraw" }} /> : null}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">No notes. {issued && concede ? "Use Credit note to take money off, or Debit note to add a charge." : ""}</p>}
      </section>
      {openChange && setup ? <div className="mt-4"><ActionButton label="Withdraw the waiting request" variant="ghost" action={withdrawInvoiceChange} values={{ id: openChange.id }} confirm={{ title: "Take this request back?", body: "The bill stays as it is and the approval request closes.", confirmLabel: "Withdraw" }} /></div> : null}
    </>
  );
}
