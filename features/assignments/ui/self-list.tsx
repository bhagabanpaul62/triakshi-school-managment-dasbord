import type { Ctx } from "@smw/feature-kit";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { EntityList, ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader, KpiRow } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { shortDate } from "@smw/ui/format";
import { SelfService } from "../service";
import { dueHint } from "../rules";
import { STATE_LABEL, STATE_TONE } from "./shared";

const icon = (name: string) => <MenuIconView name={name} className="h-4 w-4" />;

/** Student home (their own work) and parent home (one row per child): open work first, then missed, then handed in. */
export async function SelfList({ ctx }: { ctx: Ctx }) {
  const rows = await new SelfService(ctx).mine();
  const now = new Date();
  const count = (...s: string[]) => rows.filter((r) => s.includes(r.state)).length;
  const parent = ctx.role === "parent";

  const items = rows.map((r) => {
    const soon = r.state === "todo" && r.dueAt.getTime() - now.getTime() < 2 * 86_400_000;
    const label = r.state === "graded" && r.marks != null && r.maxMarks != null ? `Graded ${r.marks}/${r.maxMarks}`
      : r.state === "todo" ? dueHint(r.dueAt, now) : STATE_LABEL[r.state]!;
    return {
      id: `${r.assignmentId}-${r.studentId}`,
      open: r.state === "todo" || r.state === "returned" || r.state === "overdue",
      title: r.title,
      subtitle: [r.subjectName, r.sectionLabel, parent ? r.studentName : null].filter(Boolean).join(" · "),
      badge: <ToneBadge label={label} tone={soon ? "warning" : STATE_TONE[r.state]} />,
      meta: `Due ${shortDate(r.dueAt)}`,
      href: `/app/assignments/${r.assignmentId}`,
    };
  });

  return (
    <>
      <PageHeader eyebrow="Academics" title="Assignments" description={parent ? "Homework for your children, and how it is going." : "Your homework, nearest deadline first."} />
      <KpiRow>
        <StatCard label="To do" value={String(count("todo", "returned"))} icon={icon("assignment")} meta="open or sent back" />
        <StatCard label="Overdue" value={String(count("overdue"))} icon={icon("clock")} meta="nothing handed in" />
        <StatCard label="Handed in" value={String(count("submitted", "late"))} icon={icon("upload")} meta="waiting for marks" />
        <StatCard label="Graded" value={String(count("graded"))} icon={icon("result")} meta="marked by the teacher" />
      </KpiRow>
      {rows.length === 0 ? (
        <Panel title="Assignments"><EntityList items={[]} empty={{ title: "No assignments yet.", description: "Homework from your teachers will show up here." }} /></Panel>
      ) : (
        <>
          <Panel title={parent ? "Needs attention" : "To hand in"}>
            <EntityList items={items.filter((i) => i.open)} maxItems={200} empty={{ title: "All caught up.", description: parent ? "Nothing is waiting on your children." : "Nothing is waiting on you right now." }} />
          </Panel>
          {items.some((i) => !i.open) ? (
            <Panel title="Handed in and graded">
              <EntityList items={items.filter((i) => !i.open)} maxItems={200} empty={{ title: "Nothing yet.", description: "Work you hand in shows here." }} />
            </Panel>
          ) : null}
        </>
      )}
    </>
  );
}
