import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import type { StudentHome } from "../home-service";
import { learnerKpis } from "./learner";
import { PanelRow, Rows, SlotPanel } from "./layout";
import { AnnouncementsBody, AssignmentsBody, FeesBody, MonthGauge, NeedsActionBody, ResultBody, TimetableBody, open } from "./parts";

export function StudentHomeView({ d }: { d: StudentHome }) {
  if (!d.child) return <Panel><WidgetEmptyState title="No student is linked to your login." description="Ask the school office to link your account to your student record." /></Panel>;
  const id = d.child.id;
  const kpis = learnerKpis(d, id);
  return (
    <>
      {kpis.length ? <KpiRow>{kpis}</KpiRow> : null}
      <Rows>
        <PanelRow cells={[
          { slot: d.announcements, size: 7, node: <SlotPanel slot={d.announcements} title="Notices" action={open("/app/announcements", "All notices")}>{(rows) => <AnnouncementsBody rows={rows} />}</SlotPanel> },
          { slot: d.needsAction, size: 5, node: <SlotPanel slot={d.needsAction} title="Needs action" action={open("/app/notifications?tab=action", "All that needs action")}>{(rows) => <NeedsActionBody rows={rows} />}</SlotPanel> },
        ]} />
        <PanelRow cells={[
          { slot: d.timetable, size: 7, node: <SlotPanel slot={d.timetable} title="Today's timetable" action={open("/app/timetable", "Open timetable")}>{(t) => <TimetableBody t={t} emptyHint="Ask the office." />}</SlotPanel> },
          { slot: d.attendance, size: 5, node: <SlotPanel slot={d.attendance} title="My attendance" action={open("/app/attendance", "Open attendance")}>{(a) => <MonthGauge a={a} />}</SlotPanel> },
        ]} />
        <PanelRow cells={[
          { slot: d.assignments, size: 7, node: <SlotPanel slot={d.assignments} title="Assignments due" action={open("/app/assignments", "Open assignments")}>{(a) => <AssignmentsBody a={a} />}</SlotPanel> },
          { slot: d.results, size: 5, node: <SlotPanel slot={d.results} title="Latest result" action={open("/app/results", "Open results")}>{(r) => <ResultBody r={r} />}</SlotPanel> },
        ]} />
        <PanelRow cells={[
          { slot: d.fees, size: 12, node: <SlotPanel slot={d.fees} title="Fees" action={open(`/app/fees/students/${id}`, "Open my fees")}>{(f) => <FeesBody row={f} studentId={id} />}</SlotPanel> },
        ]} />
      </Rows>
    </>
  );
}
