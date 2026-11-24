import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { buttonVariants } from "@smw/ui/ui/button";
import { ConfirmMoney } from "@smw/ui/finance/ConfirmMoney";
import { cn } from "@smw/ui/utils";
import { todayIST } from "@smw/feature-kit/money";
import { ClaimService, LookupService } from "../service";
import { approveClaim, payClaim, rejectClaim, saveClaim, withdrawClaim } from "./actions";
import { JournalLink, NoAccess, OneRecord, SectionNav, can, one, type Search } from "./shared";

export const metadata = { title: "Claims" };

const mine: Column[] = [{ key: "title", label: "What for" }, { key: "spentOn", label: "Spent on", type: "date", hideOnMobile: true }, { key: "amountPaise", label: "Amount", type: "money" }, { key: "state", label: "State", type: "state" }, { key: "note", label: "What next" }];
const everyone: Column[] = [{ key: "userName", label: "Person", type: "person", metaKey: "title" }, ...mine.slice(1)];

export default async function ClaimsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "claim")) return <NoAccess ctx={ctx} what="Claims" who="staff" />;
  const manage = can(ctx, "manage"), sp = await searchParams, tab = manage ? one(sp.tab) || (one(sp.id) ? "all" : "mine") : "mine";
  const svc = new ClaimService(ctx), look = new LookupService(ctx);
  const query = listQueryFrom(sp);
  const page = await svc.list({ ...query, filters: { ...query.filters, scope: tab === "mine" ? "mine" : "all", ...(tab === "decide" ? { status: "submitted" } : {}) } });
  const [accounts, centres, cash] = await Promise.all([look.accounts(), look.centres(), manage ? look.cashAccounts() : []]);
  const details = new Map((await Promise.all(page.rows.filter((r) => r.status !== "paid").slice(0, 25).map((r) => svc.get(r.id)))).map((d) => [d.claim.id, d]));
  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));

  const form = (title: string, values?: Record<string, unknown>): { fields: Field[]; title: string } => ({
    title, fields: [
      { name: "title", label: "What was it for?", required: true, wide: true, placeholder: "Taxi to the board office" },
      { name: "spentOn", label: "Date you paid", type: "date", required: true, max: todayIST() }, { name: "amountPaise", label: "Amount", type: "money", required: true },
      { name: "accountId", label: "Kind of expense", type: "select", options: accountOptions, hint: "If unsure, leave it. The accountant will choose." },
      ...(centres.length ? [{ name: "costCentreId", label: "Department", type: "select" as const, options: centres.map((c) => ({ value: c.id, label: c.name })) }] : []),
      { name: "payWith", label: "Pay me", type: "select", options: [{ value: "now", label: "As soon as it is approved" }, { value: "salary", label: "With my next salary" }], required: true },
      { name: "file", label: values ? "New photo (leave blank to keep the old one)" : "Photo of the bill or slip", type: "file", accept: "image/jpeg,image/png,application/pdf", required: !values, wide: true, asJpeg: true },
    ],
  });
  const rows = page.rows.map((r) => {
    const d = details.get(r.id);
    const note = r.status === "rejected" ? `Turned down: ${d?.approval?.note ?? "no reason written"}` : r.state === "pending" ? `Waiting for ${d?.waitingFor.join(" or ") ?? "an approver"}` : r.status === "submitted" ? "Waiting for an accountant or admin"
      : r.status === "approved" ? (r.payWith === "salary" ? "Will be paid with salary" : "Approved, payment to follow") : r.status === "paid" ? `Paid ${r.paidOn ?? ""}` : "";
    return { ...r, note };
  });
  const newClaim = <FormModal {...form("New claim")} icon="money" size="lg" action={saveClaim} submitLabel="Send claim" values={{ spentOn: todayIST(), payWith: "now" }} trigger={{ label: "New claim", plus: true }} summary={<p className="text-sm text-[var(--ds-on-surface-variant)]">An accountant checks it, then you are paid back.</p>} />;
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : []))).toString();

  return (
    <>
      <PageHeader eyebrow="Expenses" title={manage ? "Claims" : "My claims"} description="Money staff spent for the school and want back, each with a photo of the bill."
        actions={<>{manage ? <Link href={`/app/expenses/claims/csv${qs ? `?${qs}` : ""}`} prefetch={false} className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Download CSV</Link> : null}{newClaim}</>} />
      <SectionNav ctx={ctx} current="/app/expenses/claims" />
      {manage ? (
        <div role="tablist" aria-label="Claims" className="mb-4 flex gap-1">
          {[["mine", "Mine"], ["decide", "To decide"], ["all", "Everyone's"]].map(([v, l]) => (
            <Link key={v} role="tab" aria-selected={tab === v} href={`/app/expenses/claims?tab=${v}`} className={cn("rounded-full px-4 py-2 text-sm hover:bg-white/[0.06]", tab === v ? "bg-white/[0.1]" : "text-[var(--ds-on-surface-muted)]")}>{l}</Link>
          ))}
        </div>
      ) : null}
      {one(sp.id) ? <OneRecord all={`/app/expenses/claims${manage ? "?tab=all" : ""}`} /> : null}
      <DataTable columns={tab === "mine" ? mine : everyone} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search claims"
        rowActions={Object.fromEntries(rows.map((r) => [r.id, (
          <span key={r.id} className="inline-flex flex-wrap items-center justify-end gap-1">
            {r.journalId ? <JournalLink id={r.journalId} label="Entry" /> : null}
            {r.userId === ctx.userId && (r.status === "rejected" || r.status === "submitted") ? <FormModal {...form(r.status === "rejected" ? "Edit and resend" : "Change this claim", r)} icon="money" size="lg" action={saveClaim} hidden={{ id: r.id }} submitLabel="Send again"
              values={{ title: r.title, spentOn: r.spentOn, amountPaise: r.amountPaise, accountId: r.accountId, costCentreId: r.costCentreId, payWith: r.payWith }} trigger={{ label: r.status === "rejected" ? "Edit and resend" : "Change", variant: "ghost", plus: false }} /> : null}
            {r.userId === ctx.userId && r.status === "submitted" ? <ActionButton label="Withdraw" variant="ghost" action={withdrawClaim} values={{ id: r.id }} confirm={{ title: "Take this claim back?", body: "It stops waiting for approval. You can edit it and send it again.", confirmLabel: "Withdraw" }} /> : null}
            {manage && r.status === "submitted" && r.state !== "pending" && r.userId !== ctx.userId ? <>
              <FormModal title={`Approve: ${r.title}`} icon="money" fields={[{ name: "accountId", label: "Expense account", type: "select", required: true, options: accountOptions }, ...(centres.length ? [{ name: "costCentreId", label: "Cost centre", type: "select" as const, options: centres.map((c) => ({ value: c.id, label: c.name })) }] : [])]}
                values={{ accountId: r.accountId, costCentreId: r.costCentreId }} hidden={{ id: r.id }} action={approveClaim} submitLabel="Approve" trigger={{ label: "Approve", plus: false }}
                summary={<p className="text-sm text-[var(--ds-on-surface-variant)]">The school then owes {r.userName} this amount. Above the bill limit it goes to an approver first.</p>} />
              <ConfirmMoney label="Turn down" action={rejectClaim} values={{ id: r.id }} amountPaise={r.amountPaise} danger confirmLabel="Turn down" reason={{ label: "Why? They will see this." }} final={false} consequence="They can edit the claim and send it again." />
            </> : null}
            {manage && r.status === "submitted" && r.userId === ctx.userId ? <span className="px-2 text-xs text-[var(--ds-on-surface-muted)]">Someone else must decide</span> : null}
            {manage && r.status === "approved" ? <FormModal title={`Pay ${r.userName}`} icon="money" fields={[{ name: "method", label: "How", type: "select", required: true, options: [{ value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }, { value: "bank_transfer", label: "Bank transfer" }] },
              { name: "cashAccountId", label: "From", type: "select", options: cash.map((c) => ({ value: c.id, label: c.name })), hint: "Blank uses the default cash box or bank." }]} values={{ method: "cash" }} hidden={{ id: r.id }} action={payClaim} submitLabel="Pay now" trigger={{ label: r.payWith === "salary" ? "Pay now instead" : "Pay now", variant: "secondary", plus: false }} /> : null}
          </span>
        )]))}
        empty={{ title: tab === "decide" ? "Nothing waiting for you" : "No claims yet", description: tab === "decide" ? "New claims from staff appear here." : "Paid for something for the school? Add a claim with the bill photo and get it back.", action: tab === "decide" ? undefined : newClaim }} />
    </>
  );
}
