import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import type { ParentHome } from "../home-service";
import { learnerKpis } from "./learner";
import { PanelRow, Rows, SlotPanel } from "./layout";
import { AbsencesList, AnnouncementsBody, AssignmentsBody, EventsBody, FeesBody, MonthGauge, ResultBody, open } from "./parts";

export function ParentHomeView({ d }: { d: ParentHome }) {
  if (!d.child) return <Panel><WidgetEmptyState title="No child is linked to your login." description="Ask the school office to link your account to your child's student record." /></Panel>;
  const id = d.child.id;
  const kpis = learnerKpis(d, id);
  const who = d.children.length > 1 ? `${d.child.name.split(" ")[0]}'s` : "";
  return (
    <>
      {kpis.length ? <KpiRow>{kpis}</KpiRow> : null}
      <Rows>
        <PanelRow cells={[
          { slot: d.fees, size: 7, node: <SlotPanel slot={d.fees} title={who ? `${who} fees` : "Fees"} action={open(`/app/fees/students/${id}`, "Open fees")}>{(f) => <FeesBody row={f} studentId={id} />}</SlotPanel> },
          { slot: d.attendance, size: 5, node: (
            <SlotPanel slot={d.attendance} title="Attendance" action={open("/app/attendance", "Open attendance")}>
              {(a) => <><MonthGauge a={a} />{d.recentAbsences.state === "ok" ? <AbsencesList rows={d.recentAbsences.data} /> : null}</>}
            </SlotPanel>
          ) },
        ]} />
        <PanelRow cells={[
          { slot: d.assignments, size: 7, node: <SlotPanel slot={d.assignments} title="Assignments due" action={open("/app/assignments", "Open assignments")}>{(a) => <AssignmentsBody a={a} />}</SlotPanel> },
          { slot: d.results, size: 5, node: <SlotPanel slot={d.results} title="Latest result" action={open("/app/results", "Open results")}>{(r) => <ResultBody r={r} />}</SlotPanel> },
        ]} />
        <PanelRow cells={[
          { slot: d.announcements, size: 7, node: <SlotPanel slot={d.announcements} title="School announcements" action={open("/app/announcements", "All announcements")}>{(rows) => <AnnouncementsBody rows={rows} />}</SlotPanel> },
          { slot: d.events, size: 5, node: <SlotPanel slot={d.events} title="Upcoming events" action={open("/app/events", "Open events")}>{(rows) => <EventsBody rows={rows} />}</SlotPanel> },
        ]} />
      </Rows>
    </>
  );
}
