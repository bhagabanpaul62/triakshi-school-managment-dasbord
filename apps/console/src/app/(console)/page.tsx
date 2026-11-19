import Link from "next/link";
import { ApprovalService, OverviewService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { SummaryRows, type SummaryRow } from "@smw/ui/kit/SummaryRows";
import { TickBar } from "@smw/ui/kit/TickBar";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow, PageHeader, PanelGrid } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { paise, relative, shortDate } from "@smw/ui/format";
import { SCHOOL_LABELS, SCHOOL_TONES } from "@/lib/tones";

export const metadata = { title: "Overview" };

const viewAll = "text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]";
const rowLink = "flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors duration-150 hover:bg-white/[0.04]";
const sub = "block truncate text-xs text-[var(--ds-on-surface-muted)]";

export default async function OverviewPage() {
  const staff = await requireStaff();
  const [o, waiting] = await Promise.all([new OverviewService(staff).summary(), new ApprovalService(staff).listPending()]);
  const icon = (n: string) => <MenuIconView name={n} />;
  const order = ["pending", "rejected", "trial", "active", "past_due", "read_only", "suspended", "cancelled"] as const;
  const late = o.overdueInvoices;
  const today = new Date();
  const daysLeft = (d: Date | null) => (d ? Math.max(0, Math.ceil((d.getTime() - today.getTime()) / 86_400_000)) : 0);

  // What needs a person today. A row turns colour only when its number is above zero.
  const needs: SummaryRow[] = [
    { key: "approvals", label: waiting.length === 1 ? "School waiting for approval" : "Schools waiting for approval", value: waiting.length, icon: icon("check"), href: "/approvals", tone: waiting.length ? "warning" : undefined },
    { key: "trials", label: "Trials ending in 7 days", value: o.trialEnding7d, icon: icon("clock"), href: "/schools?status=trial", tone: o.trialEnding7d ? "warning" : undefined },
    { key: "overdue", label: late.count ? `Overdue invoices, ${paise(late.paise)} owed` : "Overdue invoices", value: late.count, icon: icon("billing"), href: "/billing?status=overdue", tone: late.count ? "danger" : undefined },
    { key: "tickets", label: o.openTickets ? `Open tickets, ${o.unassignedTickets} with no owner` : "Open tickets", value: o.openTickets, icon: icon("support"), href: "/support?assigned=none", tone: o.urgentTickets ? "danger" : o.openTickets ? "warning" : undefined },
    ...(o.designToQuote ? [{ key: "design", label: "Design requests to quote", value: o.designToQuote, icon: icon("palette"), href: "/design-requests?status=requested", tone: "warning" as const }] : []),
  ];
  const allClear = needs.every((r) => !r.tone);

  return (
    <>
      <PageHeader eyebrow="Platform" title="Overview" description={allClear ? "Nothing needs you right now." : "What needs you today, then the state of the platform."} />
      <div className="pb-8">
        <Panel title="Needs you today" action={allClear ? <ToneBadge label="All clear" tone="success" /> : undefined}>
          <SummaryRows rows={needs} />
        </Panel>
      </div>
      <KpiRow>
        <StatCard label="Schools" value={String(o.totalSchools)} icon={icon("class")} href="/schools"
          meta={`${o.status.active ?? 0} active · ${o.status.trial ?? 0} on trial`} />
        <StatCard label="Paying schools" value={String(o.activeSubscriptions)} icon={icon("users")} href="/billing"
          meta={o.totalSchools ? `${Math.round((o.activeSubscriptions / o.totalSchools) * 100)}% of all schools` : "No schools yet"} />
        <StatCard label="Monthly revenue" value={paise(o.mrrPaise)} icon={icon("money")} href="/billing"
          meta={o.activeSubscriptions ? "Annual plans count as a twelfth" : "No paying schools yet"} />
        <StatCard label="Yearly run rate" value={paise(o.mrrPaise * 12)} icon={icon("receipt")} href="/billing" meta="Monthly revenue times 12" />
      </KpiRow>
      <PanelGrid>
        {waiting.length || o.trialsEnding.length ? (
          <>
            {waiting.length ? (
              <div className={o.trialsEnding.length ? "lg:col-span-6" : "lg:col-span-12"}>
                <Panel className="h-full" title="Waiting for approval" action={<Link href="/approvals" className={viewAll}>Review all {waiting.length}</Link>}>
                  <ul className="flex flex-col">
                    {waiting.slice(0, 5).map((s) => (
                      <li key={s.id}>
                        <Link href={`/approvals/${s.id}`} className={rowLink}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{s.name}</span>
                            <span className={sub}>{[[s.city, s.state].filter(Boolean).join(", "), s.board, s.adminEmail].filter(Boolean).join(" · ")}</span>
                          </span>
                          <ToneBadge label={s.emailVerified ? "Email verified" : "Not verified"} tone={s.emailVerified ? "success" : "warning"} />
                          <span className="w-16 text-right text-xs text-[var(--ds-on-surface-muted)]">{relative(s.createdAt)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            ) : null}
            {o.trialsEnding.length ? (
              <div className={waiting.length ? "lg:col-span-6" : "lg:col-span-12"}>
                <Panel className="h-full" title="Trials ending soon" action={<Link href="/schools?status=trial" className={viewAll}>All trials</Link>}>
                  <ul className="flex flex-col">
                    {o.trialsEnding.map((s) => (
                      <li key={s.id}>
                        <Link href={`/schools/${s.id}`} className={rowLink}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{s.name}</span>
                            <span className={sub}>Ends {shortDate(s.trialEndsAt)}. Extend it or ask them to pick a plan.</span>
                          </span>
                          <ToneBadge label={daysLeft(s.trialEndsAt) <= 1 ? "Ends today or tomorrow" : `${daysLeft(s.trialEndsAt)} days left`} tone={daysLeft(s.trialEndsAt) <= 2 ? "danger" : "warning"} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="lg:col-span-5">
          <Panel className="h-full" title="Schools by status">
            {o.totalSchools === 0 ? <WidgetEmptyState title="No schools yet." description="Create the first one from Schools." /> : (
              <ul className="flex flex-1 flex-col justify-between gap-4">
                {order.filter((s) => o.status[s]).map((s) => (
                  <li key={s} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <ToneBadge label={SCHOOL_LABELS[s]!} tone={SCHOOL_TONES[s]} />
                      <Link href={`/schools?status=${s}`} className="text-sm tabular-nums hover:underline" aria-label={`${o.status[s]} ${SCHOOL_LABELS[s]} schools`}>{o.status[s]}</Link>
                    </div>
                    <TickBar value={(o.status[s]! / o.totalSchools) * 100} tone={SCHOOL_TONES[s]} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-7">
          <Panel className="h-full" title="Recent sign-ups" action={<Link href="/schools" className={viewAll}>All schools</Link>}>
            {o.recentSignups.length === 0 ? <WidgetEmptyState title="Nobody has signed up yet." description="New schools appear here as they join." /> : (
              <ul className="flex flex-col">
                {o.recentSignups.slice(0, 5).map((s) => (
                  <li key={s.id}>
                    <Link href={`/schools/${s.id}`} className={rowLink}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{s.name}</span>
                        <span className={sub}>{[s.city, s.planName, `${s.students} students`].filter(Boolean).join(" · ")}</span>
                      </span>
                      <ToneBadge label={SCHOOL_LABELS[s.status]!} tone={SCHOOL_TONES[s.status]} />
                      <span className="hidden w-16 text-right text-xs text-[var(--ds-on-surface-muted)] sm:block">{shortDate(s.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}
