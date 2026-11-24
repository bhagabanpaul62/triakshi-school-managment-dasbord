import Link from "next/link";
import { canApprove } from "@smw/feature-finance/approvals";
import { requireCtx } from "@smw/runtime";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { KeyTotals } from "@smw/ui/finance/KeyTotals";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { StatusTrack, type TrackStep } from "@smw/ui/finance/StatusTrack";
import { PlanService } from "../service";
import { deletePlanDraft, archivePlan, submitPlan, withdrawPlan } from "./actions";
import { diffPlans, dayLabel, lateExample, lateRuleSentence, planTotals, type PlanShape } from "./logic";
import { FeesLookup } from "./lookups";
import { CopyPlanButton, NewVersionButton } from "./plan-buttons";
import { PlanPreview } from "./plan-preview";
import { PlanApprovalFile } from "./plan-approval-file";
import { PlanStudents } from "./plan-students";
import { BackLink, NoAccess, Notice, PillLink, Tabs, can, one, type Search } from "./shared";
import { CARD, H3, LINK, MUTED } from "./styles";

export const metadata = { title: "Fee plan" };

type View = Awaited<ReturnType<PlanService["get"]>>;
const shape = (v: View): PlanShape => ({ lines: v.lines.map((l) => ({ headId: l.headId, headName: l.headName, optional: l.optional, dues: l.dues.map((d) => ({ dueKey: d.dueKey, dueOn: d.dueOn, amountPaise: d.amountPaise })) })) });
const ADMISSION = { all: "All students", new: "New admissions", existing: "Existing students" } as const;

function track(status: string): TrackStep[] {
  return [
    { label: "Draft", state: status === "draft" ? "now" : "done" },
    { label: "Waiting for approval", state: status === "pending" ? "now" : status === "draft" ? "todo" : "done" },
    { label: status === "archived" ? "Published, then archived" : "Published", state: status === "published" ? "now" : status === "archived" ? "done" : "todo" },
  ];
}

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  const ctx = await requireCtx();
  // Whoever approves the plan reads it here first; only people who set fees up may change it.
  const edit = can(ctx, "setup"), back = edit ? { href: "/app/fees/plans", label: "Fee plans" } : { href: "/app/finance/approvals", label: "Approvals" };
  if (!edit && !(can(ctx, "read") && canApprove(ctx))) return <NoAccess what="Fee plans" who="accountants and admins" home="/app/fees" />;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const svc = new PlanService(ctx);
  const v = await svc.get(id).catch(() => null);
  if (!v) return <><BackLink href={back.href}>{back.label}</BackLink><Notice tone="danger" action={{ href: back.href, label: `Back to ${back.label.toLowerCase()}` }}>This plan does not exist, or it belongs to another school.</Notice></>;
  const { plan } = v, tab = edit && one(sp.tab) === "students" ? "students" : "plan";
  const before = v.versions.find((x) => x.version < plan.version);
  const q = one(sp.q).trim();
  const [prev, years, overrides, optIns] = await Promise.all([
    before ? svc.get(before.id).catch(() => null) : null, edit ? new FeesLookup(ctx).years() : [],
    tab === "students" ? svc.overrides(plan.rootId, { page: 1, pageSize: 25, q: q || undefined }) : null,
    tab === "students" ? svc.optIns(plan.rootId, { page: 1, pageSize: 25, q: q || undefined }) : null,
  ]);
  const needsFile = v.fileRequired && !v.approvalFile;
  const ap = v.approval;
  const totals = planTotals(v.lines.map((l) => ({ headId: l.headId, optional: l.optional, dues: l.dues })));
  const diff = prev ? diffPlans(shape(prev), shape(v)) : null;
  const open = v.versions.find((x) => x.id !== plan.id && (x.status === "draft" || x.status === "pending"));
  const example = lateExample(plan.lateRule);

  return (
    <>
      <BackLink href={back.href}>{back.label}</BackLink>
      <PageHeader eyebrow={`Version ${plan.version}`} title={plan.name} description={`${ADMISSION[plan.admissionType]}, ${v.classes.map((c) => c.name).join(", ") || "no classes"}`}
        actions={<><StateBadge state={plan.status} />
          {!edit ? null : <>{plan.status === "draft" ? <><PillLink href={`/app/fees/plans/${plan.id}/edit`}>Edit</PillLink>{needsFile || v.clash ? null : <ActionButton label="Send for approval" variant="default" action={submitPlan} values={{ id: plan.id }} />}</> : null}
          {plan.status === "pending" ? <ActionButton label="Withdraw" action={withdrawPlan} values={{ id: plan.id }} confirm={{ title: "Take this plan back?", body: "It returns to draft and the approval request closes. You can edit it and send it again.", confirmLabel: "Withdraw" }} /> : null}
          {plan.status === "published" ? <>{open ? <PillLink href={`/app/fees/plans/${open.id}`}>Open the {open.status === "draft" ? "draft" : "waiting"} version {open.version}</PillLink> : <NewVersionButton rootId={plan.rootId} />}<PillLink href="/app/fees/invoices/issue" primary>Issue bills</PillLink></> : null}
          {plan.status !== "pending" ? <CopyPlanButton id={plan.id} name={plan.name} years={years.map((y) => ({ id: y.id, name: y.name }))} /> : null}</>}</>} />

      <div className={`${CARD} mb-5`}><StatusTrack steps={track(plan.status)} label="Where this plan stands" /></div>
      {plan.status === "pending" ? <Notice tone="info" action={canApprove(ctx) ? { href: "/app/finance/approvals", label: "Open approvals" } : undefined}>Waiting for {ap?.waitingFor.length ? ap.waitingFor.join(" or ") : "an admin"} to approve and publish it. Nothing is billed until then.</Notice> : null}
      {plan.status === "draft" && ap?.status === "rejected" ? <Notice tone="danger" action={{ href: `/app/fees/plans/${plan.id}/edit`, label: "Edit and resend" }}>Not approved{ap.decidedByName ? ` by ${ap.decidedByName}` : ""}: {ap.note ?? "no reason was written"}</Notice> : null}
      {v.clash ? <Notice tone="danger" action={{ href: `/app/fees/plans/${v.clash.id}`, label: "Open that plan" }}>{v.clash.cls} already has a published plan, {v.clash.plan}, for the same students. A class has one plan for each kind of admission: make a new version of that plan and add these fees there, or take {v.clash.cls} out of this one.</Notice> : null}
      {plan.status === "draft" && needsFile ? <Notice tone="warning">The school asks for the committee's approval file before a plan is sent for approval. Attach it in the box on this page, then send the plan.</Notice> : null}
      {plan.status === "draft" && !ap && !needsFile && !v.clash ? <Notice tone="info" action={{ href: `/app/fees/plans/${plan.id}/edit`, label: "Edit" }}>A draft bills nobody. Send it for approval when the fees are right.</Notice> : null}
      {plan.status === "published" ? <Notice tone="info" action={edit ? { href: "/app/fees/invoices/issue", label: "Issue bills" } : undefined}>This plan is live. Bills are made by issuing them, and each student is billed once per due.</Notice> : null}

      {edit ? <Tabs label="Plan sections" tabs={[["plan", "The plan"], ["students", "Students"]]} current={tab} href={(t) => `/app/fees/plans/${id}${t === "students" ? "?tab=students" : ""}`} /> : null}

      {tab === "students" && overrides && optIns ? <PlanStudents rootId={plan.rootId} planName={plan.name} optionalHeads={v.lines.filter((l) => l.optional).map((l) => ({ id: l.headId, name: l.headName }))} overrides={overrides} optIns={optIns} q={q} /> : (

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className={CARD} aria-label="Fees in this plan">
              <KeyTotals items={[{ label: "A student pays in the year", paise: v.totalPaise, strong: true }, ...(totals.optionalPaise ? [{ label: "Optional fees", paise: totals.optionalPaise }] : [])]} />
              <div className="custom-scrollbar mt-5 overflow-x-auto"><table className="w-full min-w-[420px] text-sm">
                <thead><tr className="text-left text-xs text-[var(--ds-on-surface-muted)]"><th className="py-2 font-normal">Fee</th><th className="py-2 font-normal">Dues</th><th className="py-2 text-right font-normal">In the year</th></tr></thead>
                <tbody>{v.lines.map((l) => <tr key={l.id} className="border-t border-white/[0.06]"><td className="py-2">{l.headName}{l.optional ? <span className={`${MUTED} ml-2`}>optional</span> : null}</td><td className={`${MUTED} py-2`}>{l.dues.length === 1 ? `once, ${dayLabel(l.dues[0]!.dueOn)}` : `${l.dues.length} dues, ${dayLabel(l.dues[0]!.dueOn)} to ${dayLabel(l.dues.at(-1)!.dueOn)}`}</td><td className="py-2 text-right"><Money paise={l.dues.reduce((s, d) => s + d.amountPaise, 0)} /></td></tr>)}</tbody></table></div>
            </section>
            <section className={CARD} aria-label="Bills through the year">
              <h2 className={H3}>Bills through the year</h2>
              <ol className="custom-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">{totals.byDue.map((d) => <li key={d.dueKey} className="min-w-28 shrink-0 rounded-2xl bg-white/[0.05] p-3"><p className="text-xs text-[var(--ds-on-surface-muted)]">{d.label}</p><p className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{dayLabel(d.dueOn)}</p><Money paise={d.requiredPaise} />{d.optionalPaise ? <p className="text-[11px] text-[var(--ds-on-surface-muted)]">+{(d.optionalPaise / 100).toLocaleString("en-IN")} optional</p> : null}</li>)}</ol>
            </section>
            {diff ? (
              <section className={CARD} aria-label="Changes from the earlier version">
                <h2 className={H3}>Changes from version {before!.version}</h2>
                {diff.changes.length ? <>
                  <ul className="divide-y divide-white/[0.06] text-sm">{diff.changes.map((c, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><b className="font-medium">{c.headName}</b> <span className={MUTED}>{c.detail}</span></span>{c.deltaPaise ? <Money paise={c.deltaPaise} sign="always" tone={c.deltaPaise > 0 ? "warning" : "success"} /> : null}</li>)}</ul>
                  <p className="mt-3 text-sm">What a student pays in the year: <Money paise={diff.fromPaise} /> to <Money paise={diff.toPaise} />{diff.percent !== null ? ` (${diff.percent > 0 ? "+" : ""}${diff.percent}%)` : ""}.</p>
                </> : <p className="text-sm text-[var(--ds-on-surface-muted)]">Nothing changed in the fees or dates. Only the details around them differ.</p>}
                <p className={`${MUTED} mt-2`}>Publishing bills only what is not yet issued. Bills already issued keep the earlier price.</p>
              </section>
            ) : null}
          </div>
          <aside className="flex min-w-0 flex-col gap-5">
            <PlanApprovalFile planId={plan.id} file={v.approvalFile} required={v.fileRequired} editable={edit && plan.status === "draft"} />
            <section className={CARD}><h2 className={H3}>Late fee</h2><p className="text-sm">{lateRuleSentence(plan.lateRule)}</p>{example.sentence ? <p className={`${MUTED} mt-1`}>{example.sentence}</p> : null}</section>
            <section className={CARD}><h2 className={H3}>A student who joins during the year</h2><p className="text-sm">{plan.joinRule === "full" ? "Pays every due of the year." : "Pays only the dues from the joining month on."}</p>{plan.note ? <p className={`${MUTED} mt-2`}>Note: {plan.note}</p> : null}</section>
            <section className={CARD}><h2 className={H3}>Try it for a student</h2><PlanPreview lines={v.lines.map((l) => ({ headId: l.headId, headName: l.headName, optional: l.optional, dues: l.dues.map((d) => ({ dueKey: d.dueKey, label: d.label, billOn: d.billOn, dueOn: d.dueOn, amountPaise: d.amountPaise })) }))} /></section>
            <section className={CARD}><h2 className={H3}>Versions</h2>
              <ul className="divide-y divide-white/[0.06] text-sm">{v.versions.map((x) => <li key={x.id} className="flex items-center justify-between gap-2 py-2">{x.id === plan.id ? <span className="font-medium">Version {x.version} (this one)</span> : <Link href={`/app/fees/plans/${x.id}`} className={LINK}>Version {x.version}</Link>}<StateBadge state={x.status} /></li>)}</ul>
            </section>
            {edit && plan.status === "draft" ? <ActionButton label="Delete this draft" variant="ghost" action={deletePlanDraft} values={{ id: plan.id }} redirectTo="/app/fees/plans" confirm={{ title: "Delete this draft?", body: "Nothing was billed from it. This cannot be undone.", danger: true, confirmLabel: "Delete" }} /> : null}
            {edit && plan.status === "published" ? <ActionButton label="Archive this plan" variant="ghost" action={archivePlan} values={{ id: plan.id }} confirm={{ title: "Archive this plan?", body: "No new bills are made from it. Bills already issued stay and can still be paid.", confirmLabel: "Archive" }} /> : null}
          </aside>
        </div>
      )}
    </>
  );
}
