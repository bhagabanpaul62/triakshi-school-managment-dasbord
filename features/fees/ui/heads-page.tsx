import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FEE_HEAD_KINDS } from "../constants";
import { HeadService } from "../service";
import { deleteHead, saveHead } from "./actions";
import { NoAccess, Notice, PillLink, SectionNav, can, one, safeNext, type Search } from "./shared";

export const metadata = { title: "Fee heads" };

const KIND: Record<(typeof FEE_HEAD_KINDS)[number], string> = { tuition: "Tuition", admission: "Admission", transport: "Transport", exam: "Exam", other: "Other" };
const fields = (editing: boolean): Field[] => [
  { name: "name", label: "Name", required: true, placeholder: "Tuition, Transport, Lab fee", wide: true },
  { name: "kind", label: "Kind", type: "select", required: true, options: FEE_HEAD_KINDS.map((k) => ({ value: k, label: KIND[k] })) },
  { name: "type", label: "Is it income?", type: "select", required: true, options: [{ value: "income", label: "Income of the school" }, { value: "deposit", label: "Refundable deposit (money held for the family)" }], hint: "A deposit is owed back, so it is never counted as income. Once a bill uses this fee, this cannot change: turn it off and add a new fee instead." },
  { name: "isTuition", label: "Tuition certificate", type: "checkbox", placeholder: "Counts as tuition on the tuition fee certificate" },
  ...(editing ? [{ name: "isActive", label: "In use", type: "checkbox" as const, placeholder: "Offer it when making plans and bills" }] : []),
];
const columns: Column[] = [
  { key: "name", label: "Fee" }, { key: "kind", label: "Kind", type: "badge", labels: KIND }, { key: "type", label: "Type", type: "badge", labels: { income: "Income", deposit: "Deposit" }, tones: { deposit: "info" }, hideOnMobile: true },
  { key: "tuition", label: "Tuition certificate", hideOnMobile: true }, { key: "state", label: "State", type: "state" },
];

export default async function HeadsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "setup")) return <NoAccess what="Fee heads" who="accountants and admins" home="/app/fees" />;
  const sp = await searchParams, next = safeNext(one(sp.next));
  const page = await new HeadService(ctx).list(listQueryFrom(sp));
  const rows = page.rows.map((h) => ({ ...h, tuition: h.isTuition ? "Yes" : "", state: h.isActive ? "open" : "closed" }));
  return (
    <>
      <PageHeader eyebrow="Fees" title="Fee heads" description="The kinds of fee the school charges, like Tuition or Transport. Plans and bills are made of them."
        actions={<><FormModal title="New fee" icon="money" fields={fields(false)} values={{ kind: "other", type: "income" }} action={saveHead} successMessage="Fee added" />{next ? <PillLink href={next} primary>Back to what you were doing</PillLink> : <PillLink href="/app/fees/plans/new">Make a plan</PillLink>}</>} />
      <SectionNav ctx={ctx} current="/app/fees/heads" />
      {page.total === 0 ? <Notice tone="info">Start with Tuition. Add transport, admission or exam fees if the school charges them separately.</Notice> : null}
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search fees"
        rowActions={Object.fromEntries(page.rows.map((h) => [h.id, (
          <span key={h.id} className="flex items-center gap-1">
            <FormModal title={`Edit ${h.name}`} icon="money" fields={fields(true)} values={h} hidden={{ id: h.id }} action={saveHead} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
            <ActionButton variant="icon-delete" label={`Delete ${h.name}`} action={deleteHead} values={{ id: h.id }} confirm={{ title: `Delete ${h.name}?`, body: "A fee used in a plan or a bill cannot be deleted: turn it off with Edit instead.", danger: true, confirmLabel: "Delete" }} />
          </span>
        )]))}
        empty={{ title: "No fees yet", description: "A fee head is a kind of fee, like Tuition. Add the first one, then build a plan from it.", action: <FormModal title="New fee" icon="money" fields={fields(false)} values={{ kind: "other", type: "income" }} action={saveHead} successMessage="Fee added" /> }} />
    </>
  );
}
