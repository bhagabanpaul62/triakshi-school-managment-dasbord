import { ModuleAdminService, PlanAdminService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { paise } from "@smw/ui/format";
import { SimpleTable } from "@/components/simple-table";
import { editPlan, setPlanFlags } from "../actions";

export const metadata = { title: "Plans" };

export default async function PlansPage() {
  const staff = await requireStaff();
  const [plans, mods] = await Promise.all([new PlanAdminService(staff).list(), new ModuleAdminService(staff).list()]);
  const isOwner = staff.role === "owner";
  const fields: Field[] = [
    { name: "name", label: "Name", required: true },
    { name: "studentCap", label: "Student cap", type: "number", required: true, min: 1 },
    { name: "priceAnnualPaise", label: "Annual price", type: "money", required: true },
    { name: "priceMonthlyPaise", label: "Monthly price", type: "money", required: true },
    { name: "moduleKeys", label: "Modules included", type: "multiselect", options: mods.filter((m) => !m.core).map((m) => ({ value: m.key, label: m.name })) },
    { name: "isPublic", label: "Pricing page", type: "checkbox", placeholder: "Show on the public pricing page" },
  ];

  return (
    <>
      <PageHeader eyebrow="Platform" title="Plans" description="Saving a change creates a new version. Schools already on a plan keep their version and price." />
      <Panel>
        <SimpleTable rows={plans} empty={{ title: "No plans.", description: "Plans are added by the seed or a migration." }} columns={[
          { label: "Plan", cell: (p) => <span className="flex items-center gap-2">{p.name}<span className="text-xs text-[var(--ds-on-surface-muted)]">v{p.version}</span>{!p.isLatest ? <ToneBadge label="Old version" /> : null}</span> },
          { label: "Yearly", cell: (p) => paise(p.priceAnnualPaise), right: true },
          { label: "Monthly", cell: (p) => paise(p.priceMonthlyPaise), right: true, hideOnMobile: true },
          { label: "Up to", cell: (p) => `${p.studentCap.toLocaleString("en-IN")} students`, right: true, hideOnMobile: true },
          { label: "Modules", cell: (p) => p.moduleKeys.length, right: true, hideOnMobile: true },
          { label: "Schools", cell: (p) => p.schools, right: true },
          { label: "Shown", cell: (p) => <span className="inline-flex gap-1.5"><ToneBadge label={p.isPublic ? "Public" : "Hidden"} tone={p.isPublic ? "success" : "default"} />{!p.isActive ? <ToneBadge label="Off" tone="danger" /> : null}</span> },
          { label: "", cell: (p) => !isOwner ? null : (
            <span className="inline-flex items-center justify-end gap-1">
              {p.isLatest ? <FormModal title={`Edit ${p.name}`} description="Saves a new version." icon="receipt" fields={fields} hidden={{ id: p.id }} action={editPlan} submitLabel="Save new version"
                values={{ ...p }} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} /> : null}
              {p.isLatest ? <ActionButton variant="ghost" action={setPlanFlags} values={{ id: p.id, isActive: String(!p.isActive) }} label={p.isActive ? "Switch off" : "Switch on"}
                confirm={p.isActive ? { title: "Switch this plan off?", body: "Nobody can be moved onto it until you switch it back on. Schools already on it stay.", confirmLabel: "Switch off" } : undefined} /> : null}
            </span>
          ) },
        ]} />
      </Panel>
    </>
  );
}
