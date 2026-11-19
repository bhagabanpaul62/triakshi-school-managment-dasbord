import type { ReactNode } from "react";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { KpiRow } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import type { Timetable } from "../service";
import { LinkButton } from "./LinkButton";
import { summarize } from "./summary";
import { NowNext } from "./NowNext";
import { TimetableGrid } from "./TimetableGrid";
import type { EditorProps } from "./CellEditor";

/**
 * The body every timetable page shares: a KPI row from the grid's own numbers, then the grid in a panel.
 * Handles "no bell schedule yet" so each page does not repeat it.
 */
export function TimetableView({ timetable, perspective, editor, canSetUp, action, live, notice, after }: {
  timetable: Timetable;
  perspective: "section" | "teacher";
  editor?: EditorProps;
  /** The viewer may create the bell schedule. */
  canSetUp: boolean;
  /** Right side of the panel title row. */
  action?: ReactNode;
  /** Show "Now" and "Next" above the week: for a person's own timetable. */
  live?: boolean;
  /** Something to do before planning, above the grid (an admin's missing subject teachers). */
  notice?: ReactNode;
  /** More panels below the grid. */
  after?: ReactNode;
}) {
  if (!timetable.periods.length) {
    return (
      <Panel title="Timetable">
        <WidgetEmptyState title="No bell schedule yet" description={canSetUp ? "Set the periods of the school day, then plan each section's week." : "Your school has not set the periods of the day yet."} />
        {canSetUp ? <div className="flex justify-center pb-4"><LinkButton href="/app/timetable/periods">Set up the bell schedule</LinkButton></div> : null}
      </Panel>
    );
  }
  const s = summarize(timetable);
  const teacherView = perspective === "teacher";
  return (
    <>
      {live && s.filled > 0 ? <NowNext timetable={timetable} perspective={perspective} /> : null}
      {notice ? <div className="mb-3">{notice}</div> : null}
      <KpiRow>
        <StatCard label={teacherView ? "Per week" : "Planned"} value={teacherView ? String(s.filled) : `${s.filled} of ${s.total}`} icon={<MenuIconView name="clock" />}
          meta={!teacherView && editor ? (s.free ? `${s.free} still empty` : "Week is complete") : undefined} />
        <StatCard label={teacherView ? "Free periods" : "Empty periods"} value={String(s.free)} icon={<MenuIconView name="calendar" />} />
        <StatCard label={teacherView ? "Sections" : "Teachers"} value={String(teacherView ? s.sections : s.teachers)} icon={<MenuIconView name={teacherView ? "class" : "teacher"} />} />
        <StatCard label="Subjects" value={String(s.subjects)} icon={<MenuIconView name="subject" />} />
      </KpiRow>
      <Panel title={timetable.title} action={action}>
        {s.filled === 0 && !editor
          ? <WidgetEmptyState title="Nothing planned yet" description={teacherView ? "No periods are assigned to you yet. They show up here once the school office plans the week." : "The school office has not planned this week yet. Check back soon."} />
          : <TimetableGrid timetable={timetable} perspective={perspective} editor={editor} />}
      </Panel>
      {after ? <div className="mt-3">{after}</div> : null}
    </>
  );
}
