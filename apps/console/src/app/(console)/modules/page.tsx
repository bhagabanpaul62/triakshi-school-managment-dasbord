import { ModuleAdminService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { SimpleTable } from "@/components/simple-table";
import { STAGE_LABELS, STAGE_TONES, statusOptions } from "@/lib/tones";
import { setModuleStage } from "../actions";

export const metadata = { title: "Modules" };

export default async function ModulesPage() {
  const staff = await requireStaff();
  const mods = await new ModuleAdminService(staff).list();
  return (
    <>
      <PageHeader eyebrow="Platform" title="Modules" description="Alpha and beta modules reach only schools you switch them on for. Live modules follow the plan." />
      <Panel>
        <SimpleTable rows={mods.map((m) => ({ ...m, id: m.key }))} empty={{ title: "No modules.", description: "Modules appear when the features are registered." }} columns={[
          { label: "Module", cell: (m) => <span><span className="block text-sm">{m.name}</span><span className="block font-mono text-xs text-[var(--ds-on-surface-muted)]">{m.key}</span></span> },
          { label: "Stage", cell: (m) => <span className="inline-flex gap-1.5"><ToneBadge label={STAGE_LABELS[m.stage]!} tone={STAGE_TONES[m.stage]} />{m.core ? <ToneBadge label="Core" /> : null}</span> },
          { label: "Schools on", cell: (m) => `${m.schoolsEnabled} of ${m.schoolCount}`, right: true },
          { label: "Used in 30 days", cell: (m) => `${m.activeSchools30d} schools`, right: true, hideOnMobile: true },
          { label: "In plans", cell: (m) => m.plansIncluding, right: true, hideOnMobile: true },
          { label: "", cell: (m) => staff.role === "owner" ? (
            <FormModal title={`${m.name} stage`} icon="settings" fields={[{ name: "stage", label: "Stage", type: "select", required: true, options: statusOptions(STAGE_LABELS) }]}
              values={{ stage: m.stage }} hidden={{ key: m.key }} action={setModuleStage} submitLabel="Change stage" trigger={{ label: "Change stage", variant: "ghost", size: "sm" }} />
          ) : null },
        ]} />
      </Panel>
    </>
  );
}
