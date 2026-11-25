import Link from "next/link";
import { HatchedBars } from "@smw/ui/kit/HatchedBars";
import { StatCard } from "@smw/ui/kit/StatCard";
import { EntityList, ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { formatMoneyCompact } from "@smw/ui/money";
import { initials, paise, shortDate, tilePaise as tile } from "@smw/ui/format";
import { METHOD_LABEL } from "@smw/feature-fees/service";
import type { AccountantHome } from "../home-service";
import { plural } from "../rules";
import { PanelRow, Rows, SlotPanel } from "./layout";
import { AnnouncementsBody, NeedsActionBody, NextStep, RequestsBody, open } from "./parts";

const avatar = (name: string) => <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-xs" aria-hidden>{initials(name)}</span>;

export function AccountantHomeView({ d }: { d: AccountantHome }) {
  const m = d.money.state === "ok" ? d.money.data : null;
  return (
    <>
      <KpiRow>
        {m ? <StatCard label="Collected today" value={tile(m.todayPaise)} icon={<MenuIconView name="money" />} meta={m.todayCount ? plural(m.todayCount, "receipt") : "Nothing received yet"} href="/app/fees" /> : null}
        {m ? <StatCard label="Collected this month" value={tile(m.summary.collectedThisMonth)} icon={<MenuIconView name="receipt" />} meta={plural(m.summary.receiptsThisMonth, "receipt")} href="/app/fees" /> : null}
        {m ? <StatCard label="Outstanding" value={tile(m.summary.outstanding)} icon={<MenuIconView name="chart" />} meta={plural(m.summary.studentsWithDues, "student") + " with dues"} href="/app/fees" /> : null}
        {m ? <StatCard label="Overdue students" value={String(m.summary.overdueCount)} icon={<MenuIconView name="clock" />} meta={m.summary.overdueCount ? `${paise(m.summary.overdueAmount)} overdue` : "Nobody is behind"} href="/app/fees/dues?overdue=1" /> : null}
      </KpiRow>
      <Rows>
        <PanelRow cells={[
          { slot: d.needsAction, size: 7, node: <SlotPanel slot={d.needsAction} title="Needs action" action={open("/app/notifications?tab=action", "All that needs action")}>{(rows) => <NeedsActionBody rows={rows} />}</SlotPanel> },
          { slot: d.requests, size: 5, node: <SlotPanel slot={d.requests} title="Requests" action={open("/app/requests", "Open requests")}>{(r) => <RequestsBody r={r} />}</SlotPanel> },
        ]} />
        <PanelRow cells={[
          { slot: d.recent, size: 7, node: (
            <SlotPanel slot={d.recent} title="Recent payments" action={open("/app/fees", "Open fees")}>
              {(rows) => rows.length === 0 ? (
                <>
                  <WidgetEmptyState title="No payments recorded yet." description="Open a student's fees page to record the first payment and print its receipt." />
                  <NextStep href="/app/fees">Open fees</NextStep>
                </>
              ) : (
                <EntityList
                  maxItems={8}
                  empty={{ title: "No payments yet.", description: "" }}
                  items={rows.map((p) => ({
                    id: p.id, leading: avatar(p.student), title: p.student,
                    subtitle: <>{p.receiptNo} · {shortDate(p.paidOn)} · <a href={`/app/fees/receipts/${p.id}`} target="_blank" rel="noopener" className="text-[var(--ds-color-primary-300)] underline-offset-4 hover:underline">Receipt</a></>,
                    meta: paise(p.amountPaise), badge: <ToneBadge label={METHOD_LABEL[p.method as keyof typeof METHOD_LABEL] ?? p.method} />,
                  }))}
                />
              )}
            </SlotPanel>
          ) },
          { slot: d.overdue, size: 5, node: (
            <SlotPanel slot={d.overdue} title="Overdue" action={open("/app/fees/dues?overdue=1", "All overdue")}>
              {(o) => o.rows.length === 0 ? (
                <WidgetEmptyState title="Nobody is overdue." description="Students show here the day an installment passes its due date unpaid." />
              ) : (
                <>
                  <EntityList
                    maxItems={6}
                    empty={{ title: "", description: "" }}
                    items={o.rows.map((r) => ({
                      id: r.id, leading: avatar(r.name), title: r.name,
                      subtitle: `${r.classLabel}${r.nextDueDate ? ` · next due ${shortDate(r.nextDueDate)}` : ""}`, meta: paise(r.overdue), href: `/app/fees/students/${r.id}`,
                    }))}
                  />
                  {o.total > o.rows.length ? <Link href="/app/fees/dues?overdue=1" className="mt-3 text-sm text-[var(--ds-color-primary-300)] underline-offset-4 hover:underline">See all {o.total} ({paise(o.amountPaise)})</Link> : null}
                </>
              )}
            </SlotPanel>
          ) },
        ]} />
        <PanelRow cells={[
          { slot: d.dueByClass, size: 7, node: (
            <SlotPanel slot={d.dueByClass} title="Dues by class" action={open("/app/fees", "Open fees")}>
              {(rows) => rows.length === 0 || rows.every((r) => r.duePaise === 0) ? (
                <WidgetEmptyState title="No dues to show." description="Set up a fee structure for a class and what it owes appears here." />
              ) : (
                <HatchedBars height={220} items={rows.map((r) => ({
                  key: r.classId, label: r.name.replace(/^Class\s+/i, ""), value: r.duePaise / 100, display: formatMoneyCompact(r.duePaise / 100), href: `/app/fees/dues?classId=${r.classId}`,
                }))} />
              )}
            </SlotPanel>
          ) },
          { slot: d.announcements, size: 5, node: <SlotPanel slot={d.announcements} title="Announcements" action={open("/app/announcements", "All announcements")}>{(rows) => <AnnouncementsBody rows={rows} />}</SlotPanel> },
        ]} />
      </Rows>
    </>
  );
}
