import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { shortDate } from "@smw/ui/format";
import { todayIST } from "@smw/feature-kit/money";
import { FREQUENCIES } from "../constants";
import { LookupService, RecurringService, VendorService } from "../service";
import { deleteRecurring, runRecurring, saveRecurring, setRecurringActive } from "./actions";
import { NoAccess, Notice, SectionNav, can } from "./shared";

export const metadata = { title: "Recurring costs" };
const FREQ = { monthly: "Every month", quarterly: "Every 3 months", half_yearly: "Every 6 months", yearly: "Every year" } as const;

export default async function RecurringPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess ctx={ctx} what="Recurring costs" who="accountants and admins" />;
  const manage = can(ctx, "manage"), svc = new RecurringService(ctx), look = new LookupService(ctx);
  const [list, cal, accounts, vendors] = await Promise.all([svc.list(), svc.calendar(6), look.accounts(), new VendorService(ctx).list({ pageSize: 100, filters: { active: "1" } })]);
  const fields = [
    { name: "label", label: "Name", required: true, wide: true, placeholder: "Office rent" }, { name: "vendorId", label: "Vendor", type: "select" as const, required: true, options: vendors.rows.map((v) => ({ value: v.id, label: v.name })) },
    { name: "frequency", label: "How often", type: "select" as const, required: true, options: FREQUENCIES.map((f) => ({ value: f, label: FREQ[f] })) },
    { name: "nextOn", label: "Next bill date", type: "date" as const, required: true }, { name: "endsOn", label: "Stops after (optional)", type: "date" as const }, { name: "dueDays", label: "Days to pay", type: "number" as const, min: 0, max: 120 },
    { name: "accountId", label: "Account", type: "select" as const, required: true, options: accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })) }, { name: "amountPaise", label: "Usual amount", type: "money" as const, required: true },
  ];
  const add = manage ? <FormModal title="New recurring cost" icon="receipt" size="lg" fields={fields} values={{ frequency: "monthly", nextOn: todayIST(), dueDays: 7 }} action={saveRecurring} submitLabel="Save" trigger={{ label: "New recurring cost", plus: true }}
    summary={<p className="text-sm text-[var(--ds-on-surface-variant)]">On each date a draft bill appears for you to check and send for approval. Nothing is posted by itself.</p>} /> : null;

  return (
    <>
      <PageHeader eyebrow="Expenses" title="Recurring costs" description="Rent, electricity, internet and your own Triakshi plan: a draft bill appears each period."
        actions={<>{manage ? <ActionButton label="Make due drafts now" variant="ghost" action={runRecurring} /> : null}{add}</>} />
      <SectionNav ctx={ctx} current="/app/expenses/recurring" />
      {!vendors.rows.length && manage ? <Notice action={{ href: "/app/expenses/vendors?next=%2Fapp%2Fexpenses%2Frecurring", label: "Add a vendor" }}>A recurring cost needs a vendor. Add one first; you will come back here.</Notice> : null}
      <div className="grid gap-3 lg:grid-cols-12">
        <Panel title="Set up" className="lg:col-span-7">
          {list.length ? (
            <ul className="divide-y divide-white/[0.06]">
              {list.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0"><p className="truncate">{r.label}</p><p className="text-xs text-[var(--ds-on-surface-muted)]">{r.vendorName} · {FREQ[r.frequency]} · next {shortDate(r.nextOn)}</p></div>
                  <div className="flex flex-wrap items-center gap-2"><StateBadge state={r.isActive ? "open" : "closed"} /><Money paise={r.amountPaise} />
                    {manage ? <>
                      <FormModal title={`Edit ${r.label}`} icon="receipt" size="lg" fields={fields} hidden={{ id: r.id }} values={{ label: r.label, vendorId: r.vendorId, frequency: r.frequency, nextOn: r.nextOn, endsOn: r.endsOn, dueDays: r.dueDays, accountId: r.lines[0]?.accountId, amountPaise: r.amountPaise }} action={saveRecurring}
                        summary={r.lines.length > 1 ? <p className="text-sm text-[var(--ds-on-surface-variant)]">This has {r.lines.length} lines. Their split is kept; only the dates and details change here.</p> : undefined} trigger={{ label: "Edit", variant: "ghost", plus: false }} />
                      <ActionButton label={r.isActive ? "Pause" : "Resume"} variant="ghost" action={setRecurringActive} values={{ id: r.id, active: r.isActive ? "0" : "1" }} />
                      <ActionButton label="Remove" variant="ghost" action={deleteRecurring} values={{ id: r.id }} confirm={{ title: "Remove this recurring cost?", body: "Bills it already made stay. No new ones appear.", confirmLabel: "Remove", danger: true }} />
                    </> : null}</div>
                </li>
              ))}
            </ul>
          ) : <WidgetEmptyState title="No recurring costs yet" description="Add rent or electricity once and the draft bill appears every period." />}
        </Panel>
        <Panel title="Coming up, next 6 months" className="lg:col-span-5">
          {cal.length ? <ul className="divide-y divide-white/[0.06] text-sm">{cal.slice(0, 14).map((c, i) => <li key={i} className="flex items-center justify-between gap-3 py-2"><span className="min-w-0 truncate">{shortDate(c.date)} · {c.label}</span><Money paise={c.amountPaise} /></li>)}</ul> : <WidgetEmptyState title="Nothing scheduled" description="Dates appear once a recurring cost is active." />}
        </Panel>
      </div>
    </>
  );
}
