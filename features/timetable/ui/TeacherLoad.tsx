import { Panel } from "@smw/ui/kit/Panel";
import { TickBar } from "@smw/ui/kit/TickBar";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import type { TeacherLoad } from "../service";

/** Who carries this section's week, and how full each teacher's own week is (all sections together). */
export function TeacherLoadPanel({ load }: { load: TeacherLoad }) {
  return (
    <Panel title="Teacher load" action={<span className="text-xs text-[var(--ds-on-surface-muted)]">Periods a week, out of {load.max}</span>}>
      {load.teachers.length === 0 ? <WidgetEmptyState title="No teachers yet." description="Plan a period or auto-fill and the teachers of this section show up here." /> : (
        <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {load.teachers.map((t) => {
            const pct = load.max ? Math.round((t.total / load.max) * 100) : 0;
            return (
              <li key={t.id} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-[var(--ds-on-surface)]">{t.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{t.here} here · {t.total} in all</span>
                </div>
                <TickBar value={pct} tone={pct >= 90 ? "warning" : "info"} />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
