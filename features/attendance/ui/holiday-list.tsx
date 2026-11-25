import { Panel } from "@smw/ui/kit/Panel";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ToneBadge, type Tone } from "@smw/ui/widgets/WidgetPrimitives";
import { HOLIDAY_KINDS, type HolidayKind } from "../constants";
import type { HolidaySpan } from "../holiday-service";
import { HOLIDAY_SCOPES } from "../holiday-inputs";
import { dayLabel, groupBy } from "../stats";
import { deleteHoliday, updateHoliday } from "./holiday-actions";
import { holidayFields } from "./fields";

const KIND_TONE: Record<HolidayKind, Tone> = { national: "info", state: "info", vacation: "default", restricted: "default", emergency: "danger", other: "default", working: "success" };
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
const monthTitle = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Holidays grouped by the month they start in. A break of several days is one row. */
export function HolidayList({ spans, classes, canWrite }: { spans: HolidaySpan[]; classes: { id: string; name: string }[]; canWrite: boolean }) {
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const months = [...groupBy(spans, (s) => s.from.slice(0, 7)).entries()];
  return (
    <div className="flex flex-col gap-3">
      {months.map(([month, group]) => (
        <Panel key={month} title={monthTitle(`${month}-01`)}>
          <ul className="flex flex-col divide-y divide-white/[0.06]">
            {group.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-[var(--ds-on-surface)]">{s.name}</p>
                  <p className="text-sm text-[var(--ds-on-surface-muted)]">
                    {s.from === s.to ? `${weekday(s.from)}, ${dayLabel(s.from)}` : `${dayLabel(s.from)} to ${dayLabel(s.to)} (${s.dates.length} days)`}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <ToneBadge label={HOLIDAY_KINDS[s.kind]} tone={KIND_TONE[s.kind]} />
                    {s.appliesTo === "students" ? <ToneBadge label={HOLIDAY_SCOPES.students} tone="warning" /> : null}
                    {s.appliesTo === "classes" ? <ToneBadge label={`Only ${s.classIds.map((id) => className.get(id) ?? "a class").join(", ")}`} tone="warning" /> : null}
                  </div>
                  {s.note ? <p className="mt-1.5 break-words text-xs text-[var(--ds-on-surface-muted)]">{s.note}</p> : null}
                </div>
                {canWrite ? (
                  <span className="inline-flex shrink-0 items-center gap-1">
                    <FormModal title="Edit holiday" icon="calendar" fields={holidayFields(classes)} values={{ ...s, to: s.to === s.from ? undefined : s.to }} hidden={{ id: s.id }} action={updateHoliday} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
                    <ActionButton variant="icon-delete" label="Delete holiday" action={deleteHoliday} values={{ id: s.id }}
                      confirm={{ title: "Remove this holiday?", body: `${s.name} will open for attendance again${s.dates.length > 1 ? `, for all ${s.dates.length} days` : ""}.`, confirmLabel: "Remove", danger: true }} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
