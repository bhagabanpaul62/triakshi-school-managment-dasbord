import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { GradeScaleService, ReportSetupService } from "../service";
import { applyPreset, createScale, deleteCoScale, deleteScale, makeDefaultScale, saveBands, saveCoScale, saveTemplate } from "./actions";
import { BandsEditor, CoScaleEditor, TemplateEditor } from "./setup-editors";
import { ErrorPanel, attempt } from "./shared";

export const metadata = { title: "Report setup" };

/** Grade scales, co-scholastic scales and the report setup of each class band. Anyone with exam access can read it; `manage` edits. */
export default async function ScalesPage() {
  const ctx = await requireCtx();
  const grades = new GradeScaleService(ctx);
  const setup = new ReportSetupService(ctx);
  const canEdit = grades.can("manage");
  const loaded = await attempt(async () => {
    const scales = (await grades.list({ pageSize: 100, sort: "name", dir: "asc" })).rows;
    const [bands, coScales, templates] = await Promise.all([Promise.all(scales.map((s) => grades.bands(s.id))), setup.coScales(), setup.templates()]);
    return { scales: scales.map((s, i) => ({ ...s, bands: bands[i]! })), coScales, templates };
  });
  if (!loaded.ok) return <ErrorPanel message={loaded.error} />;
  const { scales, coScales, templates } = loaded.data;

  return (
    <>
      <PageHeader eyebrow="Academics" title="Report setup" description="Grade scales, co-scholastic grades and what each class band's report card shows."
        actions={canEdit ? (
          <>
            <ActionButton action={applyPreset} values={{ preset: "cbse_9" }} label="Add CBSE 9-band" successMessage="CBSE 9-band scale is ready" />
            <ActionButton action={applyPreset} values={{ preset: "cbse_co" }} label="Add CBSE co-scholastic A-C" successMessage="Co-scholastic scale is ready" />
          </>
        ) : null} />

      <h2 className="mb-3 text-sm font-medium text-[var(--ds-on-surface)]">Report card per class band</h2>
      <div className="mb-8 flex flex-col gap-3">
        {templates.map((t) => (
          <TemplateEditor key={t.classBand} template={t} canEdit={canEdit} action={saveTemplate} presetAction={applyPreset}
            scales={scales.map((s) => ({ value: s.id, label: s.name }))} coScales={coScales.map((s) => ({ value: s.id, label: s.name }))} />
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--ds-on-surface)]">Grade scales</h2>
        {canEdit ? <FormModal title="New scale" icon="exam" fields={[{ name: "name", label: "Scale name", required: true }, { name: "isDefault", label: "Default", type: "checkbox", placeholder: "Use this scale for every class band without its own" }]} action={createScale} submitLabel="Add scale" /> : null}
      </div>
      <div className="mb-8 flex flex-col gap-3">
        {scales.length === 0 ? <Panel><WidgetEmptyState title="No scale yet." description="Grades use the built-in CBSE 9-band scale until you add one." /></Panel> : null}
        {scales.map((s) => (
          <Panel key={s.id} title={s.name} action={
            <span className="inline-flex items-center gap-2">
              {s.isDefault ? <ToneBadge label="Default" tone="success" /> : canEdit ? (
                <>
                  <ActionButton action={makeDefaultScale} values={{ id: s.id, name: s.name }} label="Make default" variant="ghost" />
                  <ActionButton variant="icon-delete" label={`Delete ${s.name}`} action={deleteScale} values={{ id: s.id }}
                    confirm={{ title: "Delete this scale?", body: `"${s.name}" and its grades will be removed.`, confirmLabel: "Delete", danger: true }} />
                </>
              ) : null}
            </span>}>
            <BandsEditor scaleId={s.id} bands={s.bands} action={saveBands} canEdit={canEdit} />
          </Panel>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-medium text-[var(--ds-on-surface)]">Co-scholastic scales</h2></div>
      <div className="flex flex-col gap-3">
        {coScales.map((c) => (
          <Panel key={c.id} title={c.name} action={c.isDefault ? <ToneBadge label="Default" tone="success" /> : undefined}>
            <CoScaleEditor scale={c} action={saveCoScale} removeAction={deleteCoScale} canEdit={canEdit} />
          </Panel>
        ))}
        {canEdit ? <Panel title="Add a co-scholastic scale"><CoScaleEditor action={saveCoScale} removeAction={deleteCoScale} canEdit /></Panel> : null}
      </div>
    </>
  );
}
