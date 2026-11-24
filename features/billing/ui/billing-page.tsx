import { BillingService } from "@smw/billing";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { Button } from "@smw/ui/ui/button";
import { TickBar } from "@smw/ui/kit/TickBar";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader, KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { paise, shortDate } from "@smw/ui/format";
import { CheckoutButton } from "./checkout-button";
import { CreditsTab } from "./credits-tab";
import { InvoicesTab } from "./invoices-tab";
import { PaymentsTab } from "./payments-tab";
import { PlanPicker } from "./plan-picker";
import { StatementTab } from "./statement-tab";
import { BILLING_TABS, BillingTabs, type BillingTab } from "./tabs";
import { payInvoice } from "./actions";

export const metadata = { title: "Billing" };

const STATUS_LABEL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" | "default" }> = {
  active: { label: "Active", tone: "success" }, trial: { label: "Free trial", tone: "info" }, past_due: { label: "Payment due", tone: "warning" },
  read_only: { label: "Read-only", tone: "danger" }, suspended: { label: "Suspended", tone: "danger" }, cancelled: { label: "Cancelled", tone: "default" },
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new BillingService(ctx);
  const params = await searchParams;
  const tabParam = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: BillingTab = BILLING_TABS.find((t) => t.id === tabParam)?.id ?? "invoices";
  const [o, options, owing] = await Promise.all([svc.overview(), svc.planOptions(), svc.owing()]);
  const canManage = svc.can("manage");
  const pct = o.cap ? (o.students / o.cap) * 100 : 0;
  const status = STATUS_LABEL[o.school.status] ?? { label: o.school.status, tone: "default" as const };
  const trial = o.school.status === "trial";
  const endDate = o.subscription?.periodEnd ?? (trial ? o.school.trialEndsAt : null);
  const oldest = owing.invoices[0];
  const placesLeft = Math.max(0, o.cap - o.students);

  // The one thing to do next, in order of urgency.
  const next = oldest
    ? { title: `You owe ${paise(owing.duePaise)} now`,
        body: `${owing.invoices.length > 1 ? `${owing.invoices.length} invoices are unpaid. Pay the oldest first: ${oldest.number}, ${paise(oldest.duePaise)}.` : `Invoice ${oldest.number}, GST included${oldest.overdue ? ", is overdue" : ""}.`} Pay it to keep your school running without interruption.${owing.creditPaise ? ` You also have ${paise(owing.creditPaise)} credit, used on your next invoice.` : ""}`,
        tone: oldest.overdue ? "danger" as const : "warning" as const,
        cta: canManage ? <CheckoutButton action={payInvoice} values={{ id: oldest.id }} label={`Pay ${paise(oldest.duePaise)}`} /> : null }
    : o.tdsAwaited
      ? { title: `Upload ${o.tdsAwaited === 1 ? "your TDS certificate" : `${o.tdsAwaited} TDS certificates`}`, body: "You withheld tax when you paid us. Send the certificate so we can match it to our records.", tone: "info" as const,
          cta: <Button asChild className="h-10 rounded-full"><a href="/app/billing?tab=payments">Go to payments</a></Button> }
    : trial
      ? { title: `${o.daysLeft ?? 0} ${o.daysLeft === 1 ? "day" : "days"} left in your free trial`, body: `Choose a plan before ${shortDate(endDate)} so your school carries on without a break.`, tone: "info" as const,
          cta: canManage ? <Button asChild className="h-10 rounded-full"><a href="#plans">Compare plans</a></Button> : null }
      : pct >= 80
        ? { title: pct >= 100 ? "You are at your student cap" : "You are close to your student cap", body: `${o.students.toLocaleString("en-IN")} of ${o.cap.toLocaleString("en-IN")} students. Move to a bigger plan before you cannot add more.`, tone: pct >= 100 ? "danger" as const : "warning" as const,
            cta: canManage ? <Button asChild className="h-10 rounded-full"><a href="#plans">See bigger plans</a></Button> : null }
        : { title: "Everything is in order", body: endDate ? `Your plan renews on ${shortDate(endDate)}. ${placesLeft.toLocaleString("en-IN")} student places left.` : `${placesLeft.toLocaleString("en-IN")} student places left on your plan.`, tone: "success" as const, cta: null };

  return (
    <>
      <PageHeader eyebrow="School" title="Billing" description="Your plan, usage and GST invoices."
        actions={<ToneBadge label={status.label} tone={status.tone} />} />
      <KpiRow>
        <StatCard label="Plan" value={o.plan?.name ?? (trial ? "Free trial" : "No plan")} href="#plans"
          meta={o.subscription ? `${o.subscription.interval === "annual" ? "Billed yearly" : "Billed monthly"}${o.subscription.pendingPlanName ? ` · ${o.subscription.pendingPlanName} from next renewal` : ""}` : trial ? "Pick a plan to continue" : undefined} />
        <StatCard label={trial ? "Trial days left" : "Days to renewal"} value={o.daysLeft == null ? "-" : String(o.daysLeft)}
          meta={endDate ? `${trial ? "Trial ends" : "Renews"} ${shortDate(endDate)}` : "No renewal date"} />
        <StatCard label="Students" value={`${o.students.toLocaleString("en-IN")} / ${o.cap.toLocaleString("en-IN")}`} meta={`${placesLeft.toLocaleString("en-IN")} places left`} />
        <StatCard label="Unpaid invoices" value={String(o.unpaidInvoices)} href="/app/billing?tab=invoices" meta={o.unpaidInvoices ? "Pay to avoid interruption" : o.creditPaise ? `${paise(o.creditPaise)} credit on your account` : "All paid"} />
      </KpiRow>
      <PanelGrid>
        <div className="lg:col-span-12">
          <Panel title={oldest ? "What you owe now" : "What to do next"} action={<ToneBadge label={next.tone === "success" ? "On track" : next.tone === "info" ? "Next step" : "Action needed"} tone={next.tone} />}>
            <div className="grid items-center gap-5 lg:grid-cols-2">
              <div>
                <p className="text-[18px] font-medium tracking-tight">{next.title}</p>
                <p className="mt-1 max-w-[56ch] text-sm text-[var(--ds-on-surface-variant)]">{next.body}</p>
                {next.cta ? <div className="mt-4">{next.cta}</div> : null}
                {!canManage ? <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">Only the school administrator can change the plan or pay.</p> : null}
              </div>
              <div>
                <div className="mb-2 flex items-baseline justify-between text-sm"><span className="text-[var(--ds-on-surface-variant)]">Student cap used</span><span className="tabular-nums">{Math.round(pct)}%</span></div>
                <TickBar value={pct} tone={pct >= 100 ? "danger" : pct >= 80 ? "warning" : "success"} />
              </div>
            </div>
          </Panel>
        </div>
        <div className="scroll-mt-6 lg:col-span-12" id="plans">
          <Panel title={canManage ? "Choose or change your plan" : "Plans"}>
            <PlanPicker plans={options.plans.map((p) => ({ key: p.key, name: p.name, studentCap: p.studentCap, priceAnnualPaise: p.priceAnnualPaise, priceMonthlyPaise: p.priceMonthlyPaise, modules: p.modules.map((m) => m.name) }))}
              currentKey={o.plan?.key ?? null} currentInterval={o.subscription?.interval ?? null} recommendedKey={options.recommendedKey} students={options.students} canManage={canManage} onTrial={trial} />
          </Panel>
        </div>
      </PanelGrid>
      <div className="relative mt-8 scroll-mt-6 overflow-x-clip" id="records">
        <BillingTabs active={tab} counts={{ payments: o.tdsAwaited }} />
        {tab === "invoices" ? <InvoicesTab svc={svc} params={params} canManage={canManage} /> : null}
        {tab === "payments" ? <PaymentsTab svc={svc} params={params} canManage={canManage} /> : null}
        {tab === "credits" ? <CreditsTab svc={svc} params={params} /> : null}
        {tab === "statement" ? <StatementTab svc={svc} params={params} /> : null}
      </div>
    </>
  );
}
