import { notFound } from "next/navigation";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow, PageHeader, PanelGrid } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { MenuIconView } from "@smw/ui/shell/icons";
import { paise, shortDate } from "@smw/ui/format";
import { FeeHeadService, FeeStructureService } from "../service";
import { StructureEditor } from "./structure-editor";
import { copyStructure, createHead, deleteHead, deleteStructure, saveStructure, updateHead } from "./actions";
import { copyFields, describeRule, headFields, tile } from "./fields";

export const metadata = { title: "Fee setup" };

const headColumns: Column[] = [
  { key: "name", label: "Fee" },
  { key: "kind", label: "Type", type: "badge" },
  { key: "recurring", label: "Repeats", hideOnMobile: true },
];

export default async function FeeSetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const heads = new FeeHeadService(ctx), structures = new FeeStructureService(ctx);
  if (!heads.can("manage")) notFound();
  const [overview, page] = await Promise.all([structures.overview(), heads.list(listQueryFrom(await searchParams))]);
  const withFees = overview.classes.filter((c) => c.structure).length;
  const totals = overview.classes.flatMap((c) => (c.structure ? [c.structure.total] : []));
  const lo = Math.min(...totals), hi = Math.max(...totals);
  const withLate = overview.classes.filter((c) => c.structure?.lateRules.length).length;
  const rows = page.rows.map((h) => ({ ...h, recurring: h.isRecurring ? "Every year" : "One time" }));
  const addHead = <FormModal title="New fee" icon="receipt" fields={headFields} action={createHead} submitLabel="Add" values={{ kind: "tuition", isRecurring: true }} />;

  return (
    <>
      <PageHeader eyebrow="Finance" title="Fee setup" description={`Fee types, then what each class pays and when, for ${overview.year.name}.`} actions={addHead} />
      <KpiRow>
        <StatCard label="Classes billed" value={`${withFees} of ${overview.classes.length}`} icon={<MenuIconView name="check" />} meta={withFees === overview.classes.length && withFees > 0 ? "Everyone is being billed" : `${overview.classes.length - withFees} still not billed`} />
        <StatCard label="Fee types" value={String(page.total)} icon={<MenuIconView name="receipt" />} meta="Tuition, admission, exam and so on" />
        <StatCard label="Top yearly fee" value={totals.length ? tile(hi) : "-"} icon={<MenuIconView name="money" />} meta={totals.length ? `Per student, ${paise(lo)}${lo === hi ? "" : ` to ${paise(hi)}`}` : "Set up a class to see this"} />
        <StatCard label="Late fees" value={`${withLate} of ${withFees}`} icon={<MenuIconView name="clock" />} meta={withLate ? "Classes charging a late fee" : "No late fee charged"} />
      </KpiRow>
      <div className="flex flex-col gap-8">
        <DataTable
          columns={headColumns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount}
          searchPlaceholder="Search fees"
          empty={{ title: "No fees yet.", description: "Add Tuition, Admission, Exam and so on, then price them for each class.", action: addHead }}
          rowActions={Object.fromEntries(rows.map((r) => [r.id, (
            <span key={r.id} className="inline-flex items-center gap-1">
              <FormModal title="Edit fee" icon="receipt" fields={headFields} values={r} hidden={{ id: r.id }} action={updateHead} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
              <ActionButton variant="icon-delete" label="Delete fee" action={deleteHead} values={{ id: r.id }}
                confirm={{ title: `Delete ${r.name}?`, body: "It must not be part of any class's fees. This cannot be undone.", confirmLabel: "Delete", danger: true }} />
            </span>
          )]))}
        />

        <section aria-labelledby="by-class">
          <h2 id="by-class" className="mb-3 text-[15px] font-medium">Fees by class</h2>
          {overview.classes.length === 0 ? (
            <Panel><WidgetEmptyState title="No classes yet." description="Add classes under Academic setup first." /></Panel>
          ) : (
            <PanelGrid>
              {overview.classes.map((c) => {
                const s = c.structure;
                const others = overview.classes.filter((o) => o.id !== c.id && !o.structure);
                return (
                  <div key={c.id} className="lg:col-span-6">
                    <Panel title={c.name} className="h-full" action={(
                      <>
                        {s && others.length ? <FormModal title={`Copy ${c.name} fees`} icon="receipt" fields={copyFields(others)} hidden={{ id: s.id }} action={copyStructure} submitLabel="Copy" trigger={{ label: "Copy to…", variant: "ghost", size: "sm" }} /> : null}
                        <StructureEditor classId={c.id} className={c.name} heads={overview.heads.map((h) => ({ id: h.id, name: h.name }))} structure={s} action={saveStructure} />
                        {s ? <ActionButton variant="icon-delete" label={`Delete ${c.name} fees`} action={deleteStructure} values={{ id: s.id }}
                          confirm={{ title: `Delete fees for ${c.name}?`, body: "Concessions stay, but nothing is billed for this class until you set fees again. Not allowed once payments exist.", confirmLabel: "Delete", danger: true }} /> : null}
                      </>
                    )}>
                      {s ? (
                        <div className="flex flex-col gap-4">
                          <p className="text-[26px] font-medium tabular-nums tracking-tight">{paise(s.total)}<span className="ml-2 text-xs font-normal text-[var(--ds-on-surface-muted)]">a year</span></p>
                          <ul className="flex flex-col gap-1 text-sm">
                            {s.items.map((i) => <li key={i.headId} className="flex justify-between gap-3"><span className="text-[var(--ds-on-surface-variant)]">{i.headName}</span><span className="tabular-nums">{paise(i.amountPaise)}</span></li>)}
                          </ul>
                          <ul className="flex flex-col gap-1 rounded-2xl bg-white/[0.035] p-4 text-sm">
                            {s.installments.map((i) => <li key={i.id} className="flex justify-between gap-3"><span>{i.name}<span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">due {shortDate(i.dueDate)}</span></span><span className="tabular-nums">{paise(i.amountPaise)}</span></li>)}
                          </ul>
                          <p className="text-xs text-[var(--ds-on-surface-muted)]">{s.lateRules.length ? `Late fee: ${s.lateRules.map(describeRule).join("; ")}` : "No late fee."}</p>
                        </div>
                      ) : <WidgetEmptyState title="No fees set." description={overview.heads.length ? "Students in this class are not billed yet. Use Set up fees." : "Add a fee type above first (like Tuition), then set up fees for this class."} />}
                    </Panel>
                  </div>
                );
              })}
            </PanelGrid>
          )}
        </section>
      </div>
    </>
  );
}
