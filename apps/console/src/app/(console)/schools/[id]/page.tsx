import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError, listQueryFrom } from "@smw/feature-kit";
import { AuditAdminService, PlanAdminService, SchoolAdminService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { TickBar } from "@smw/ui/kit/TickBar";
import { SummaryRows, type SummaryRow } from "@smw/ui/kit/SummaryRows";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { DataTable } from "@smw/ui/shell/DataTable";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { dateTime, paise, shortDate } from "@smw/ui/format";
import { ReviewActions } from "@/components/review-actions";
import { TabLinks } from "@/components/tab-links";
import { SimpleTable } from "@/components/simple-table";
import { DOMAIN_LABELS, DOMAIN_TONES, PRIORITY_TONES, SCHOOL_LABELS, SCHOOL_TONES, STAGE_LABELS, STAGE_TONES, TICKET_LABELS, TICKET_TONES } from "@/lib/tones";
import { changePlan, createSupportLogin, extendTrial, makeSchoolReadOnly, reactivateSchool, removeOverride, scheduleDeletion, setOverride, suspendSchool } from "../../actions";
import { SupportLoginDialog } from "./support-login-dialog";

export const metadata = { title: "School" };

const TABS = ["overview", "modules", "domains", "invoices", "tickets", "audit"] as const;
type Tab = (typeof TABS)[number];

const INVOICE_LABELS: Record<string, string> = { issued: "Due", paid: "Paid", void: "Cancelled", draft: "Draft" };
const invoiceLabel = (i: { status: string; dueAt: Date | null }) => (i.status === "issued" && i.dueAt && i.dueAt.getTime() < Date.now() ? "Overdue" : INVOICE_LABELS[i.status] ?? i.status);

const overrideFields: Field[] = [
  { name: "enabled", label: "Module", type: "checkbox", placeholder: "Turn it on for this school (untick to force it off)" },
  { name: "note", label: "Note", type: "textarea", hint: "Why. Shown to the team." },
  { name: "expiresAt", label: "Expires on", type: "date", hint: "Leave empty for no end date." },
];

export default async function SchoolPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "overview";
  const staff = await requireStaff();
  const svc = new SchoolAdminService(staff);
  let detail;
  try { detail = await svc.detail(id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const { school: s, plan, studentCount } = detail;
  const isOwner = staff.role === "owner";
  const canStatus = isOwner || staff.role === "support";
  const canSales = isOwner || staff.role === "sales";
  const running = s.status === "active" || s.status === "trial";
  const underReview = s.status === "pending" || s.status === "rejected";
  const base = `/schools/${id}`;

  const [plans, admins, invoiceRows, ticketRows, domainRows] = await Promise.all([
    canSales ? new PlanAdminService(staff).list() : Promise.resolve([]),
    canStatus ? svc.admins(id) : Promise.resolve([]),
    svc.invoices(id), svc.tickets(id), svc.domains(id),
  ]);
  const now = Date.now();
  const unpaid = invoiceRows.filter((i) => i.status === "issued");
  const overdue = unpaid.filter((i) => i.dueAt && i.dueAt.getTime() < now);
  const openTickets = ticketRows.filter((t) => t.status === "open" || t.status === "pending");
  const brokenDomains = domainRows.filter((d) => d.status === "failed");

  const actions: ReactNode = (
    <>
      {underReview ? <ReviewActions id={id} name={s.name} status={s.status} adminEmail={s.email} canDecide={isOwner} /> : null}
      {canStatus ? <SupportLoginDialog schoolId={id} users={admins.filter((a) => a.status === "active").map((a) => ({ id: a.id, name: a.name }))} canWrite={isOwner} action={createSupportLogin} /> : null}
      {canSales && !underReview ? <FormModal title="Extend trial" icon="clock" fields={[{ name: "days", label: "Add days", type: "number", required: true, min: 1, max: 365 }]} values={{ days: 14 }} hidden={{ id }} action={extendTrial} submitLabel="Extend"
        trigger={{ label: "Extend trial", variant: "secondary" }} summary={s.trialEndsAt ? `Ends ${shortDate(s.trialEndsAt)} now` : "No trial date yet"} /> : null}
      {canSales ? <FormModal title="Change plan" icon="receipt" fields={[{ name: "planId", label: "Plan", type: "select", required: true, options: plans.filter((p) => p.isLatest && p.isActive).map((p) => ({ value: p.id, label: `${p.name} (up to ${p.studentCap} students)` })) }]}
        values={{ planId: s.planId }} hidden={{ id }} action={changePlan} submitLabel="Change plan" trigger={{ label: "Change plan", variant: "secondary" }}
        summary={`Student cap becomes the plan's cap. Now ${s.studentCap}.`} /> : null}
    </>
  );

  const capPct = s.studentCap ? (studentCount / s.studentCap) * 100 : 0;
  const capTone = capPct >= 100 ? "danger" : capPct >= 90 ? "warning" : "info";
  const daysLeft = s.trialEndsAt ? Math.ceil((s.trialEndsAt.getTime() - Date.now()) / 86_400_000) : null;
  const icon = (n: string) => <MenuIconView name={n} />;

  const trialSoon = s.status === "trial" && daysLeft !== null && daysLeft <= 7;
  const needs: SummaryRow[] = [
    ...(underReview ? [{ key: "review", label: s.status === "pending" ? "Waiting for approval" : "Rejected, can be reopened", value: "Review", tone: "warning" as const, href: `/approvals/${id}` }] : []),
    ...(s.status === "suspended" || s.status === "read_only" || s.status === "past_due" ? [{ key: "state", label: `${SCHOOL_LABELS[s.status]} since ${shortDate(s.statusChangedAt)}`, value: "Lifecycle", tone: "danger" as const }] : []),
    ...(trialSoon ? [{ key: "trial", label: daysLeft! <= 0 ? "Trial has ended" : `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`, value: "Extend", tone: "warning" as const }] : []),
    ...(capPct >= 90 ? [{ key: "cap", label: capPct >= 100 ? "At the student cap" : "Near the student cap", value: `${studentCount} / ${s.studentCap}`, tone: capPct >= 100 ? "danger" as const : "warning" as const }] : []),
    ...(overdue.length ? [{ key: "overdue", label: `Overdue invoice${overdue.length === 1 ? "" : "s"}, ${paise(overdue.reduce((a, i) => a + i.totalPaise, 0))} owed`, value: overdue.length, tone: "danger" as const, href: `${base}?tab=invoices` }] : []),
    ...(openTickets.length ? [{ key: "tickets", label: "Open tickets", value: openTickets.length, tone: "warning" as const, href: `${base}?tab=tickets` }] : []),
    ...(brokenDomains.length ? [{ key: "domains", label: "Domain failing its DNS check", value: brokenDomains.length, tone: "danger" as const, href: `${base}?tab=domains` }] : []),
  ];

  const lifecycle: { key: string; title: string; effect: string; button: ReactNode }[] = [
    ...(canStatus && running ? [
      { key: "ro", title: "Make read-only", effect: "They can sign in and export, but change nothing.",
        button: <ActionButton action={makeSchoolReadOnly} values={{ id }} label="Make read-only" confirm={{ title: "Make this school read-only?", body: `${s.name} can still sign in and export, but cannot change anything.`, confirmLabel: "Make read-only" }} /> },
      { key: "sus", title: "Suspend", effect: "Everyone loses access except Billing and Settings.",
        button: <ActionButton action={suspendSchool} values={{ id }} label="Suspend" confirm={{ title: "Suspend this school?", body: `${s.name} loses access to everything except Billing and Settings until you reactivate it.`, confirmLabel: "Suspend", danger: true }} /> },
    ] : []),
    ...(canStatus && !running && !underReview ? [
      { key: "re", title: "Reactivate", effect: `Full access returns${s.deletionScheduledAt ? " and the scheduled deletion is cancelled" : ""}.`,
        button: <ActionButton variant="default" action={reactivateSchool} values={{ id }} label="Reactivate" confirm={{ title: "Reactivate this school?", body: `${s.name} gets its full access back${s.deletionScheduledAt ? " and the scheduled deletion is cancelled" : ""}.`, confirmLabel: "Reactivate" }} /> },
    ] : []),
    ...(isOwner && !s.deletionScheduledAt ? [
      { key: "del", title: "Schedule deletion", effect: "All data is marked for deletion in 30 days. Reactivating cancels it.",
        button: <ActionButton action={scheduleDeletion} values={{ id }} label="Schedule deletion" confirm={{ title: "Schedule deletion?", body: `All of ${s.name}'s data is marked for deletion in 30 days. Reactivating the school cancels this.`, confirmLabel: "Schedule deletion", danger: true }} /> },
    ] : []),
  ];

  let body: ReactNode;
  if (tab === "overview") {
    body = (
      <>
        <div className="pb-8">
          <Panel title="Needs attention" action={needs.length ? undefined : <ToneBadge label="All clear" tone="success" />}>
            {needs.length ? <SummaryRows rows={needs} /> : <p className="px-1 text-sm text-[var(--ds-on-surface-muted)]">Nothing here needs a person. The school is within its student cap, billing is current and no tickets are open.</p>}
          </Panel>
        </div>
        <KpiRow>
          <StatCard label="Students" value={`${studentCount}`} icon={icon("users")} meta={`of ${s.studentCap} allowed`} viz={<div className="w-24"><TickBar value={capPct} tone={capTone} /></div>} />
          <StatCard label="Plan" value={plan ? plan.name : "None"} icon={icon("receipt")} meta={plan ? `Version ${plan.version}` : "Not on a plan"} />
          <StatCard label="Trial" value={s.status === "trial" && daysLeft !== null ? `${Math.max(0, daysLeft)} days` : "-"} icon={icon("clock")} meta={s.trialEndsAt ? `Ends ${shortDate(s.trialEndsAt)}` : s.status === "pending" ? "Starts when approved" : "No trial date"} />
          <StatCard label="Joined" value={shortDate(s.createdAt)} icon={icon("calendar")} meta={`Status since ${shortDate(s.statusChangedAt)}`} />
        </KpiRow>
        <PanelGrid>
          <div className="lg:col-span-7">
            <Panel className="h-full" title="Details">
              <FactList>
                <Fact label="Address" copy={s.slug}>{s.slug}</Fact>
                <Fact label="Email" copy={s.email ?? undefined}>{s.email}</Fact>
                <Fact label="Phone" copy={s.phone ?? undefined}>{s.phone}</Fact>
                <Fact label="Board">{s.board}</Fact>
                <Fact label="Location">{[s.city, s.state].filter(Boolean).join(", ")}</Fact>
                <Fact label="GSTIN" copy={s.gstin ?? undefined}>{s.gstin}</Fact>
                <Fact label="UDISE code">{s.udiseCode}</Fact>
                <Fact label="Setup">{s.setupCompletedAt ? `Finished ${shortDate(s.setupCompletedAt)}` : "Not finished"}</Fact>
              </FactList>
            </Panel>
          </div>
          <div className="lg:col-span-5">
            <Panel className="h-full" title="Lifecycle">
              <FactList>
                <Fact label="Status"><ToneBadge label={SCHOOL_LABELS[s.status]!} tone={SCHOOL_TONES[s.status]} /></Fact>
                <Fact label="Trial ends">{s.trialEndsAt ? dateTime(s.trialEndsAt) : null}</Fact>
                <Fact label="Deletion">{s.deletionScheduledAt ? `Scheduled for ${shortDate(s.deletionScheduledAt)}` : null}</Fact>
              </FactList>
              {lifecycle.length ? (
                <ul className="flex flex-col gap-3 pt-5">
                  {lifecycle.map((a) => (
                    <li key={a.key} className="flex items-center justify-between gap-4">
                      <span className="min-w-0 text-xs text-[var(--ds-on-surface-muted)]"><span className="block text-sm text-[var(--ds-on-surface-variant)]">{a.title}</span>{a.effect}</span>
                      {a.button}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          </div>
        </PanelGrid>
      </>
    );
  } else if (tab === "modules") {
    const mods = await svc.moduleStates(id);
    body = (
      <Panel title="Modules" action={<span className="text-xs text-[var(--ds-on-surface-muted)]">{mods.filter((m) => m.enabled).length} of {mods.length} on</span>}>
        <ul className="flex flex-col">
          {mods.map((m) => (
            <li key={m.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-2 py-3 transition-colors duration-150 hover:bg-white/[0.04]">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm">{m.name}
                  <ToneBadge label={STAGE_LABELS[m.stage]!} tone={STAGE_TONES[m.stage]} />
                  {m.core ? <ToneBadge label="Core" /> : null}
                </span>
                <span className="mt-1 block text-xs text-[var(--ds-on-surface-muted)]">
                  {m.override
                    ? `Forced ${m.override.enabled ? "on" : "off"}${m.override.expiresAt ? ` until ${shortDate(m.override.expiresAt)}` : ""}${m.override.note ? ` · ${m.override.note}` : ""}`
                    : m.core ? "Always on" : m.enabled ? "On through the plan" : m.stage === "ga" ? "Not in this plan" : "Early access, off until you switch it on"}
                </span>
              </span>
              <ToneBadge label={m.enabled ? "On" : "Off"} tone={m.enabled ? "success" : "default"} />
              {canStatus ? (
                <span className="inline-flex items-center gap-1">
                  <FormModal title={`${m.name} override`} icon="settings" fields={overrideFields} hidden={{ id, moduleKey: m.key }}
                    values={{ enabled: m.override ? m.override.enabled : !m.enabled, note: m.override?.note, expiresAt: m.override?.expiresAt?.toISOString().slice(0, 10) }}
                    action={setOverride} submitLabel="Save override" trigger={{ label: m.override ? "Edit override" : "Override", variant: "ghost", size: "sm" }} />
                  {m.override ? <ActionButton variant="ghost" action={removeOverride} values={{ id, moduleKey: m.key }} label="Remove" successMessage="Override removed"
                    confirm={{ title: "Remove this override?", body: `${m.name} goes back to what the plan says.`, confirmLabel: "Remove" }} /> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
    );
  } else if (tab === "domains") {
    const rows = domainRows;
    body = (
      <Panel title="Domains">
        <SimpleTable rows={rows} empty={{ title: "No domains.", description: "Every school gets a subdomain when it is created." }} columns={[
          { label: "Address", cell: (d) => <span className="font-mono text-xs">{d.hostname}{d.isPrimary ? "  (main)" : ""}</span> },
          { label: "Kind", cell: (d) => (d.kind === "custom" ? "Custom domain" : "Subdomain"), hideOnMobile: true },
          { label: "Status", cell: (d) => <ToneBadge label={DOMAIN_LABELS[d.status] ?? d.status} tone={DOMAIN_TONES[d.status]} /> },
          { label: "Last checked", cell: (d) => (d.lastCheckedAt ? dateTime(d.lastCheckedAt) : "-"), hideOnMobile: true },
        ]} />
      </Panel>
    );
  } else if (tab === "invoices") {
    const rows = invoiceRows;
    body = (
      <Panel title="Invoices">
        <SimpleTable rows={rows} empty={{ title: "No invoices yet.", description: "Invoices appear once the school is billed." }} columns={[
          { label: "Number", cell: (i) => <span className="font-mono text-xs">{i.number}</span> },
          { label: "For", cell: (i) => i.description, hideOnMobile: true },
          { label: "Status", cell: (i) => <ToneBadge label={invoiceLabel(i)} tone={i.status === "paid" ? "success" : i.status === "void" ? "default" : i.status === "issued" && i.dueAt && i.dueAt.getTime() < now ? "danger" : "warning"} /> },
          { label: "Issued", cell: (i) => shortDate(i.createdAt), hideOnMobile: true },
          { label: "Total", cell: (i) => paise(i.totalPaise), right: true },
        ]} />
      </Panel>
    );
  } else if (tab === "tickets") {
    const rows = ticketRows;
    body = (
      <Panel title="Support tickets">
        <SimpleTable rows={rows} empty={{ title: "No tickets.", description: "This school has not asked for help." }} columns={[
          { label: "Subject", cell: (t) => <Link href={`/support/${t.id}`} className="hover:underline">{t.subject}</Link> },
          { label: "Status", cell: (t) => <ToneBadge label={TICKET_LABELS[t.status]!} tone={TICKET_TONES[t.status]} /> },
          { label: "Priority", cell: (t) => <ToneBadge label={t.priority[0]!.toUpperCase() + t.priority.slice(1)} tone={PRIORITY_TONES[t.priority] ?? "default"} />, hideOnMobile: true },
          { label: "Last message", cell: (t) => (t.lastMessageAt ? dateTime(t.lastMessageAt) : "-") },
        ]} />
      </Panel>
    );
  } else {
    const log = await new AuditAdminService(staff).school(id, listQueryFrom(sp));
    const rows = log.rows.map((r) => ({ ...r, when: dateTime(r.createdAt), who: r.viaSupport ? `${r.userName ?? "User"} (support session)` : r.userName }));
    body = (
      <DataTable columns={[
        { key: "when", label: "When" }, { key: "module", label: "Module", type: "badge", hideOnMobile: true },
        { key: "summary", label: "What happened" }, { key: "who", label: "Who", hideOnMobile: true },
      ]} rows={rows} total={log.total} page={log.page} pageCount={log.pageCount} searchPlaceholder="Search the school's log"
        empty={{ title: "Nothing logged yet.", description: "Changes made inside the school's panel are recorded here." }} />
    );
  }

  return (
    <>
      <EntityHeader back={{ href: "/schools", label: "Schools" }} title={s.name}
        chips={<ToneBadge label={SCHOOL_LABELS[s.status]!} tone={SCHOOL_TONES[s.status]} />}
        meta={[s.slug, [s.city, s.state].filter(Boolean).join(", "), plan?.name]} actions={actions} />
      <div className="flex flex-col gap-6 pt-6">
        <div><TabLinks base={base} active={tab} tabs={TABS.map((t) => ({ id: t, label: t[0]!.toUpperCase() + t.slice(1), count: t === "invoices" ? unpaid.length : t === "tickets" ? openTickets.length : undefined }))} /></div>
        {body}
      </div>
    </>
  );
}
