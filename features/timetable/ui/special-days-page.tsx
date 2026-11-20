import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { PeriodService } from "../service";
import { RulesService } from "../rules-service";
import { removeOverride, saveOverride } from "./actions";
import { orNotFound } from "./guard";
import { LinkButton } from "./LinkButton";

export const metadata = { title: "Special days" };

/** /app/timetable/special-days: dates that hold only some periods (exam day, half day). The "today" views follow them. */
export default async function SpecialDaysPage() {
  const ctx = await requireCtx();
  const rules = new RulesService(ctx);
  const list = await orNotFound(rules.overrides());
  const periods = (await new PeriodService(ctx).all()).filter((p) => !p.isBreak);
  const name = new Map(periods.map((p) => [p.id, p.name]));
  const fields: Field[] = [
    { name: "date", label: "Date", type: "date", required: true },
    { name: "label", label: "What is it", required: true, placeholder: "Half day", hint: "Shown to teachers and students that day" },
    { name: "periodIds", label: "Periods held", type: "multiselect", required: true, options: periods.map((p) => ({ value: p.id, label: p.name })), hint: "Every other period is skipped that day" },
  ];
  return (
    <>
      <PageHeader eyebrow="Timetable" title="Special days" description="A date that runs only some periods, such as an exam day or a half day. Today's timetable follows it."
        actions={<><FormModal title="Add special day" icon="calendar" fields={fields} action={saveOverride} submitLabel="Save" /><LinkButton href="/app/timetable">Timetable</LinkButton></>} />
      <Panel title="Dates">
        {!list.length ? <WidgetEmptyState title="No special days" description="Add one when a date does not follow the usual periods." /> : (
          <ul className="flex flex-col gap-1.5">
            {list.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-2.5 text-sm">
                <span className="min-w-0 text-[var(--ds-on-surface)]">{o.date} · {o.label}<span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{o.periodIds.map((id) => name.get(id)).filter(Boolean).join(", ")}</span></span>
                <ActionButton variant="icon-delete" label={`Remove ${o.date}`} action={removeOverride} values={{ id: o.id }}
                  confirm={{ title: `Remove ${o.date}?`, body: "That date goes back to the usual periods.", confirmLabel: "Remove", danger: true }} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
