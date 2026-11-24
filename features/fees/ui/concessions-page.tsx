import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { rupees } from "@smw/feature-kit/money";
import { requireCtx } from "@smw/runtime";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { EmptyLine } from "@smw/ui/finance/States";
import { ConcessionService, ConcessionTypeService, HeadService, type Suggestion } from "../service";
import { deleteConcessionType, endConcession, proposeConcession, saveConcessionType, withdrawConcession } from "./actions";
import { ConcessionForm, type ConcessionType } from "./concession-form";
import { FeesLookup } from "./lookups";
import { NoAccess, Notice, PillLink, SectionNav, Tabs, can, one, queryOf, type Search } from "./shared";
import { CARD, MUTED } from "./styles";

export const metadata = { title: "Concessions" };

const KIND_LABEL = { sibling: "Brother or sister", rte: "RTE seat", staff_child: "Staff child" } as const;
const worth = (mode: "percent" | "amount", value: number) => (mode === "percent" ? `${value / 100}%` : rupees(value));
const reqColumns: Column[] = [
  { key: "studentName", label: "Student", type: "person" }, { key: "kind", label: "Kind", hideOnMobile: true }, { key: "what", label: "Discount" }, { key: "headName", label: "On", hideOnMobile: true },
  { key: "status", label: "State", type: "state" }, { key: "note", label: "Where it stands", hideOnMobile: true },
];
const typeFields = (heads: { id: string; name: string }[]): Field[] => [
  { name: "name", label: "Name", required: true, placeholder: "Sibling, Merit, Staff child", wide: true },
  { name: "auto", label: "Suggest automatically", type: "select", options: [{ value: "sibling", label: "Brothers and sisters" }, { value: "rte", label: "RTE seats" }, { value: "staff_child", label: "Staff children" }], hint: "Matching students are listed under Suggestions. Nothing is applied by itself." },
  { name: "mode", label: "Discount is", type: "select", required: true, options: [{ value: "percent", label: "A percent" }, { value: "amount", label: "An amount" }] },
  { name: "value", label: "Percent or rupees", type: "money", required: true, hint: "For a percent, type 10 for 10%." },
  { name: "headId", label: "Applies to", type: "select", options: heads.map((h) => ({ value: h.id, label: `${h.name} only` })), hint: "Blank means every fee that can be discounted." },
  { name: "per", label: "An amount is", type: "select", options: [{ value: "year", label: "For the whole year, spread over the bills" }, { value: "bill", label: "Off every bill" }] },
  { name: "isActive", label: "In use", type: "checkbox", placeholder: "Offer it when giving a concession" },
];

export default async function ConcessionsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "concede")) return <NoAccess what="Concessions" who="accountants and admins" home="/app/fees" />;
  const sp = await searchParams, tab = ["requests", "suggestions", "types", "rte"].includes(one(sp.tab)) ? one(sp.tab) : "requests";
  const svc = new ConcessionService(ctx), types = new ConcessionTypeService(ctx);
  const [heads, typeList, pending] = await Promise.all([
    new HeadService(ctx).options().then((h) => h.filter((x) => x.isActive)),
    types.list({ page: 1, pageSize: 100 }),
    svc.list({ page: 1, pageSize: 1, filters: { status: "pending" } }).then((r) => r.total),
  ]);
  const choices: ConcessionType[] = typeList.rows.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, mode: t.mode, value: t.value, headId: t.headId, per: t.per }));
  const qs = queryOf(sp, ["page", "tab"]);
  const tabHref = (t: string) => `/app/fees/concessions${t === "requests" ? "" : `?tab=${t}`}`;
  const headList = heads.map((h) => ({ id: h.id, name: h.name }));

  let body: React.ReactNode = null;
  if (tab === "requests") {
    const page = await svc.list(listQueryFrom(sp));
    const ap = await new FeesLookup(ctx).approvals(["fees.concession"], page.rows.map((r) => r.id));
    const typeName = new Map(typeList.rows.map((t) => [t.id, t.auto ? KIND_LABEL[t.auto] : t.name]));
    const rows = page.rows.map((c) => {
      const a = ap.get(c.id);
      return { ...c, kind: c.typeId ? typeName.get(c.typeId) ?? c.typeName : c.typeName ?? "Other", what: `${worth(c.mode, c.value)}${c.mode === "amount" ? (c.per === "year" ? " for the year" : " per bill") : ""}`, headName: c.headName ?? "Every fee",
        note: c.status === "pending" ? `Waiting for ${a?.waitingFor.join(" or ") || "an admin"}` : c.status === "rejected" ? `Not approved${a?.decidedByName ? ` by ${a.decidedByName}` : ""}: ${a?.note ?? c.reason}` : c.status === "approved" ? c.reason : "Ended" };
    });
    body = (
      <DataTable columns={reqColumns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/fees/students/{studentId}" searchPlaceholder="Search students"
        filters={[{ key: "status", label: "State", options: [{ value: "pending", label: "Waiting" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Not approved" }, { value: "ended", label: "Ended" }] }]}
        rowActions={Object.fromEntries(page.rows.map((c) => [c.id, (
          <span key={c.id} className="flex items-center gap-1">
            {c.status === "pending" ? <ActionButton label="Withdraw" variant="ghost" action={withdrawConcession} values={{ id: c.id }} confirm={{ title: "Take this request back?", body: "Nothing changes on the student's bills. You can send a new request.", confirmLabel: "Withdraw" }} /> : null}
            {c.status === "rejected" ? <ConcessionForm types={choices} heads={headList} student={{ id: c.studentId, label: c.studentName }} again={{ id: c.id, typeId: c.typeId, headId: c.headId, mode: c.mode, value: c.value, per: c.per, reason: c.reason }} label="Edit and resend" variant="ghost" /> : null}
            {c.status === "approved" ? <ActionButton label="End" variant="ghost" action={endConcession} values={{ id: c.id }} confirm={{ title: "End this concession?", body: "It stops for bills issued from now on. Bills already issued keep what they got.", confirmLabel: "End it" }} /> : null}
          </span>
        )]))}
        empty={{ title: "No concession requests", description: "A discount for a student is a request: it applies at once under the school's limit and waits for an approver above it.", action: <ConcessionForm types={choices} heads={headList} /> }} />
    );
  } else if (tab === "suggestions") {
    const list = await svc.suggestions();
    const groups = (["sibling", "rte", "staff_child"] as const).map((k) => ({ k, items: list.filter((s) => s.kind === k) }));
    body = list.length ? (
      <div className="flex flex-col gap-6">{groups.filter((g) => g.items.length).map((g) => (
        <section key={g.k} aria-label={KIND_LABEL[g.k]}><h2 className="mb-3 text-sm font-medium">{KIND_LABEL[g.k]} <span className={MUTED}>{g.items.length}</span></h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{g.items.map((s: Suggestion) => (
            <article key={`${s.kind}${s.studentId}`} className={`${CARD} flex flex-col gap-2`}>
              <Link href={`/app/fees/students/${s.studentId}`} className="font-medium underline-offset-4 hover:underline">{s.studentName}</Link>
              <p className={MUTED}>{s.reason}. Suggested: {worth(s.mode, s.value)} off {s.headId ? heads.find((h) => h.id === s.headId)?.name ?? "one fee" : "every fee"}.</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <ActionButton label="Accept" variant="default" action={proposeConcession} successMessage="Concession sent" values={{ studentId: s.studentId, mode: s.mode, value: String(s.value), reason: s.reason, ...(s.typeId ? { typeId: s.typeId } : {}), ...(s.headId ? { headId: s.headId } : {}) }} />
                <ConcessionForm types={choices} heads={headList} student={{ id: s.studentId, label: s.studentName }} label="Change first" variant="ghost" />
              </div>
            </article>))}</div></section>))}</div>
    ) : <EmptyLine title="No suggestions right now" hint="Brothers and sisters, RTE seats and staff children who have no concession yet appear here. Turn on suggestions for a kind in Types." />;
  } else if (tab === "types") {
    body = (
      <DataTable columns={[{ key: "name", label: "Name" }, { key: "auto", label: "Suggested for", hideOnMobile: true }, { key: "what", label: "Discount" }, { key: "headName", label: "On", hideOnMobile: true }, { key: "state", label: "State", type: "state" }]} searchable={false}
        rows={typeList.rows.map((t) => ({ ...t, auto: t.auto ? KIND_LABEL[t.auto] : "", what: `${worth(t.mode, t.value)}${t.mode === "amount" ? (t.per === "year" ? " for the year" : " per bill") : ""}`, headName: heads.find((h) => h.id === t.headId)?.name ?? "Every fee", state: t.isActive ? "open" : "closed" }))}
        total={typeList.total} page={1} pageCount={1}
        toolbar={<FormModal title="New concession type" icon="check" fields={typeFields(headList)} values={{ mode: "percent", isActive: true, per: "year" }} action={saveConcessionType} successMessage="Concession type saved" />}
        rowActions={Object.fromEntries(typeList.rows.map((t) => [t.id, (
          <span key={t.id} className="flex items-center gap-1">
            <FormModal title={`Edit ${t.name}`} icon="check" fields={typeFields(headList)} values={t} hidden={{ id: t.id }} action={saveConcessionType} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
            <ActionButton variant="icon-delete" label={`Delete ${t.name}`} action={deleteConcessionType} values={{ id: t.id }} confirm={{ title: `Delete ${t.name}?`, body: "A type already given to a student cannot be deleted: turn it off with Edit instead.", danger: true, confirmLabel: "Delete" }} />
          </span>)]))}
        empty={{ title: "No concession types", description: "Types like Sibling or Merit save typing and set the limits. Add one, or give a one-off concession from the Requests tab.", action: <FormModal title="New concession type" icon="check" fields={typeFields(headList)} values={{ mode: "percent", isActive: true, per: "year" }} action={saveConcessionType} /> }} />
    );
  } else {
    const rteTypes = new Set(typeList.rows.filter((t) => t.auto === "rte").map((t) => t.id));
    const page = await svc.list({ page: 1, pageSize: 100, filters: { status: "approved" } });
    const rte = page.rows.filter((c) => c.typeId && rteTypes.has(c.typeId));
    body = rte.length ? (
      <section className={CARD}><div className="mb-3 flex items-center justify-between"><p className={MUTED}>Students on an approved RTE seat. The school claims their tuition from the government.</p><Link href="/app/fees/export/rte" prefetch={false} className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm font-medium hover:bg-white/[0.12]">Download CSV</Link></div>
        <ul className="divide-y divide-white/[0.06] text-sm">{rte.map((c) => <li key={c.id}><Link href={`/app/fees/students/${c.studentId}`} className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.04]"><span>{c.studentName}</span><span className={MUTED}>{worth(c.mode, c.value)} off {c.headName ?? "every fee"}</span></Link></li>)}</ul></section>
    ) : <EmptyLine title="No RTE seats yet" hint={rteTypes.size ? "Accept a suggestion for a student on an RTE seat and they are listed here." : "Make a concession type that is suggested for RTE seats (100% off tuition), then accept the suggestions."} action={rteTypes.size ? <PillLink href="/app/fees/concessions?tab=suggestions">See suggestions</PillLink> : <PillLink href="/app/fees/concessions?tab=types">Open types</PillLink>} />;
  }

  return (
    <>
      <PageHeader eyebrow="Fees" title="Concessions" description="Discounts for siblings, staff children, RTE seats and merit. Each is a request, and nothing applies by itself."
        actions={<ConcessionForm types={choices} heads={headList} />} />
      <SectionNav ctx={ctx} current="/app/fees/concessions" />
      {pending ? <Notice tone="info" action={tab === "requests" && qs.includes("status=pending") ? undefined : { href: "/app/fees/concessions?status=pending", label: "Show them" }}>{pending} request{pending === 1 ? " is" : "s are"} waiting for an approver.</Notice> : null}
      <Tabs label="Concession sections" current={tab} href={tabHref} tabs={[["requests", "Requests"], ["suggestions", "Suggestions"], ["types", "Types"], ["rte", "RTE seats"]]} />
      {body}
    </>
  );
}
