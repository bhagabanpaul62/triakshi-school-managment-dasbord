import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { fyOf, todayIST } from "@smw/feature-kit/money";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { EmptyLine } from "@smw/ui/finance/States";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { CostCentreService } from "../services/accounts";
import { CashAccountService } from "../services/cash";
import { SettingsService } from "../services/finance-settings";
import { PeriodService } from "../services/periods";
import { SeriesService } from "../services/series";
import { closePeriod, createCashAccount, createCostCentre, deleteCostCentre, editSeries, reopenPeriod, saveSettings, setCashAccountActive, setCostCentreActive, setDefaultCashAccount, softClosePeriod, updateCashAccount, updateCostCentre } from "./actions";
import { InlineForm } from "./inline-form";
import { monthLabel } from "./labels";
import { UrlTabs } from "./url-tabs";

export const metadata = { title: "Finance setup" };

const TABS = [{ id: "rules", label: "Rules" }, { id: "series", label: "Number series" }, { id: "periods", label: "Periods" }, { id: "cash", label: "Cash accounts and UPI" }, { id: "centres", label: "Cost centres" }];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const GHOST = { variant: "ghost", size: "sm" } as const;
const ROW = "flex min-h-11 flex-wrap items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-white/[0.04]";

const cashDetails: Field[] = [
  { name: "name", label: "Name", required: true },
  { name: "bankName", label: "Bank" }, { name: "accountLast4", label: "Last 4 digits of the account" }, { name: "ifsc", label: "IFSC" },
  { name: "upiId", label: "UPI ID", hint: "Like school@bank. Families scan a QR made from it." }, { name: "upiName", label: "Name on the UPI payment" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const settings = new SettingsService(ctx);
  if (!settings.can("settings")) notFound();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.id === one(sp.tab)) ? one(sp.tab)! : "rules";
  const next = one(sp.next)?.startsWith("/app/") ? one(sp.next) : undefined;

  return (
    <>
      <PageHeader eyebrow="Finance" title="Finance setup" description="The school's money rules, document numbering, month locks, bank accounts and cost centres."
        actions={next ? <Link href={next} className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.12]">Back to where you were</Link> : null} />
      <div className="pb-6"><UrlTabs tabs={TABS} value={tab} label="Finance setup" /></div>
      {tab === "rules" ? <Rules svc={settings} /> : null}
      {tab === "series" ? <Series ctx={ctx} /> : null}
      {tab === "periods" ? <Periods ctx={ctx} fy={one(sp.fy)} /> : null}
      {tab === "cash" ? <Cash ctx={ctx} /> : null}
      {tab === "centres" ? <Centres ctx={ctx} /> : null}
    </>
  );
}

async function Rules({ svc }: { svc: SettingsService }) {
  const s = await svc.get();
  const fields: Field[] = [
    { name: "basis", label: "Accounting basis", type: "select", required: true, section: "Books",
      hint: s.basisLocked ? "This financial year has entries, so the basis is fixed until April." : "Accrual counts fee income when billed; cash counts it when received. Fixed once the year has entries.",
      options: [{ value: "accrual", label: "Accrual (income when billed)" }, { value: "cash", label: "Cash (income when received)" }].filter((o) => !s.basisLocked || o.value === s.basis) },
    { name: "backdateDays", label: "Days money may be dated back", type: "number", min: 0, max: 365, section: "Books" },
    { name: "concessionLimitPaise", label: "Concessions without approval, up to", type: "money", hint: "0 means every one needs approval.", section: "Approvals" },
    { name: "billLimitPaise", label: "Vendor bills without approval, up to", type: "money", section: "Approvals" },
    { name: "cashLimitPaise", label: "Warn when one person takes this much cash in a day", type: "money", section: "Approvals" },
    { name: "counterDifferenceLimitPaise", label: "Counter difference allowed without approval", type: "money", section: "Fees" },
    { name: "bounceChargePaise", label: "Charge for a bounced cheque", type: "money", section: "Fees" },
    { name: "lateFeeFirst", label: "Late fee first", type: "checkbox", placeholder: "A payment clears the late fee before the fee itself", section: "Fees" },
    { name: "autoUseAdvance", label: "Advances", type: "checkbox", placeholder: "Use extra money on the next invoice by itself", section: "Fees" },
    { name: "upiOn", label: "UPI", type: "checkbox", placeholder: "Families pay by UPI QR and enter the reference", section: "Fees" },
    { name: "holdReportCards", label: "Report cards", type: "checkbox", placeholder: "Hold report cards while fees are overdue", section: "Fees" },
    { name: "remindersOn", label: "Reminders", type: "checkbox", placeholder: "Send fee reminders", section: "Reminders" },
    { name: "reminderDays", label: "Days around the due date", hint: "Minus is before. Example: -7, 0, 3, 10, 30", section: "Reminders" },
  ];
  return <Panel title="Rules"><InlineForm fields={fields} values={{ ...s, reminderDays: s.reminderDays.join(", ") }} action={saveSettings} submitLabel="Save rules" /></Panel>;
}

async function Series({ ctx }: { ctx: Awaited<ReturnType<typeof requireCtx>> }) {
  const rows = await new SeriesService(ctx).list();
  return (
    <Panel title="Number series">
      <p className="pb-3 text-xs text-[var(--ds-on-surface-muted)]">Numbers never skip and restart every April. A series can change only until its first number is used.</p>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.key} className={ROW}>
            <span className="min-w-0 flex-1">{r.label}<span className="block font-mono text-xs text-[var(--ds-on-surface-muted)]">Next: {r.next}</span></span>
            {r.locked ? <ToneBadge label="In use" tone="default" /> : (
              <FormModal title={`Numbering for ${r.label.toLowerCase()}`} icon="receipt" hidden={{ key: r.key }} action={editSeries} values={{ ...r }} trigger={{ label: "Change", ...GHOST }}
                fields={[{ name: "prefix", label: "Prefix", required: true, hint: "Letters, digits and dashes." }, { name: "width", label: "Digits", type: "number", min: 3, max: 10, required: true }, { name: "startAt", label: "Start at", type: "number", min: 1, required: true }]} />
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function Periods({ ctx, fy }: { ctx: Awaited<ReturnType<typeof requireCtx>>; fy?: string }) {
  const year = fy && /^\d{4}-\d{2}$/.test(fy) ? fy : fyOf(todayIST());
  const rows = await new PeriodService(ctx).list(year);
  const y = Number(year.slice(0, 4)), label = (n: number) => `${n}-${String((n + 1) % 100).padStart(2, "0")}`;
  return (
    <Panel title={`Months of ${year}`} action={<span className="flex gap-2 text-sm"><Link className="underline" href={`?tab=periods&fy=${label(y - 1)}`}>Earlier year</Link><Link className="underline" href={`?tab=periods&fy=${label(y + 1)}`}>Later year</Link></span>}>
      <p className="pb-3 text-xs text-[var(--ds-on-surface-muted)]">A locked month takes no new entries. A late entry lands in the next open month and keeps its own date.</p>
      <ul className="flex flex-col">
        {rows.map((p) => (
          <li key={p.month} className={ROW}>
            <span className="w-24 shrink-0">{monthLabel(p.month)}</span>
            <StateBadge state={p.status} />
            <span className="min-w-0 flex-1 text-xs text-[var(--ds-on-surface-muted)]">{p.entries} entries{p.pendingApprovals ? ` · ${p.pendingApprovals} still waiting for approval` : ""}{p.reason ? ` · ${p.reason}` : ""}</span>
            <span className="inline-flex items-center gap-1">
              {p.status === "open" ? <ActionButton variant="ghost" label="Soft close" action={softClosePeriod} values={{ month: p.month }} /> : null}
              {p.status !== "closed" ? <ActionButton variant="ghost" label="Close" action={closePeriod} values={{ month: p.month }} confirm={{ title: `Close ${monthLabel(p.month)}?`, body: "New entries dated in this month will land in the next open month. You can reopen it with a reason.", confirmLabel: "Close month" }} /> : null}
              {p.status !== "open" ? <FormModal title={`Reopen ${monthLabel(p.month)}`} icon="clock" hidden={{ month: p.month }} action={reopenPeriod} submitLabel="Reopen" trigger={{ label: "Reopen", ...GHOST }} fields={[{ name: "reason", label: "Why is it reopened?", type: "textarea", required: true }]} /> : null}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function Cash({ ctx }: { ctx: Awaited<ReturnType<typeof requireCtx>> }) {
  const rows = await new CashAccountService(ctx).list();
  const add = <FormModal title="New cash or bank account" icon="money" action={createCashAccount} submitLabel="Add" values={{ kind: "bank" }}
    fields={[{ name: "kind", label: "Type", type: "select", required: true, options: [{ value: "cash", label: "Cash box" }, { value: "bank", label: "Bank account" }] }, ...cashDetails, { name: "isDefault", label: "Default", type: "checkbox", placeholder: "Use it when nobody picks an account" }]} />;
  return (
    <Panel title="Cash accounts and UPI" action={add}>
      {rows.length === 0 ? <EmptyLine title="No cash or bank account yet." hint="Receipts need one to land in. Add the cash box and the school bank account." /> : (
        <ul className="flex flex-col">
          {rows.map((a) => (
            <li key={a.id} className={ROW}>
              <span className="min-w-0 flex-1">{a.name}<span className="block text-xs text-[var(--ds-on-surface-muted)]">{a.kind === "cash" ? "Cash" : "Bank"}{a.upiId ? ` · UPI ${a.upiId}` : ""}{a.isDefault ? " · Default" : ""}{!a.isActive ? " · Off" : ""}</span></span>
              <FormModal title={`Edit ${a.name}`} icon="money" fields={cashDetails} values={a} hidden={{ id: a.id }} action={updateCashAccount} trigger={{ label: "Edit", ...GHOST }} />
              {a.isActive && !a.isDefault ? <ActionButton variant="ghost" label="Make default" action={setDefaultCashAccount} values={{ id: a.id }} /> : null}
              <ActionButton variant="ghost" label={a.isActive ? "Switch off" : "Switch on"} action={setCashAccountActive} values={{ id: a.id, active: a.isActive ? "0" : "1" }}
                confirm={a.isActive ? { title: `Switch off ${a.name}?`, body: a.balancePaise ? "It still holds money. Move it to another account in Banking first." : "It leaves the pickers. Its history stays.", confirmLabel: "Switch off" } : undefined} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

async function Centres({ ctx }: { ctx: Awaited<ReturnType<typeof requireCtx>> }) {
  const { rows } = await new CostCentreService(ctx).list({ pageSize: 100, sort: "name", dir: "asc" });
  const fields: Field[] = [{ name: "name", label: "Name", required: true, hint: "A department or area, like Transport or Hostel." }];
  return (
    <Panel title="Cost centres" action={<FormModal title="New cost centre" icon="book" fields={fields} action={createCostCentre} submitLabel="Add" />}>
      {rows.length === 0 ? <EmptyLine title="No cost centres yet." hint="Tag entry lines with one to see spending by department or area." /> : (
        <ul className="flex flex-col">
          {rows.map((c) => (
            <li key={c.id} className={ROW}>
              <span className="min-w-0 flex-1">{c.name}{!c.isActive ? <span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">Off</span> : null}</span>
              <FormModal title={`Rename ${c.name}`} icon="book" fields={fields} values={c} hidden={{ id: c.id }} action={updateCostCentre} trigger={{ label: "Rename", ...GHOST }} />
              <ActionButton variant="ghost" label={c.isActive ? "Switch off" : "Switch on"} action={setCostCentreActive} values={{ id: c.id, active: c.isActive ? "0" : "1" }} />
              <ActionButton variant="icon-delete" label={`Delete ${c.name}`} action={deleteCostCentre} values={{ id: c.id }} confirm={{ title: `Delete ${c.name}?`, body: "Only possible while no entry uses it. Switch it off instead to keep the history.", confirmLabel: "Delete", danger: true }} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
