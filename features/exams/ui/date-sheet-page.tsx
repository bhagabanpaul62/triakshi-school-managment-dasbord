import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { DateSheetService } from "../service";
import { saveDateSheet } from "./actions";
import { DateSheetForm } from "./sheets";
import { ErrorPanel, STATUS_LABEL, STATUS_TONE, attempt } from "./shared";

export const metadata = { title: "Date sheet" };

/** Dates and times of every paper, one panel per class, with the clash check and admit card downloads. */
export default async function DateSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, ctx] = await Promise.all([params, requireCtx()]);
  const svc = new DateSheetService(ctx);
  const loaded = await attempt(() => svc.forExam(id));
  if (!loaded.ok) return <ErrorPanel message={loaded.error} />;
  const { exam, groups, clashes, sections } = loaded.data;
  if (exam.id !== id) notFound();
  const canEdit = svc.can("manage") && exam.status !== "published";
  return (
    <>
      <EntityHeader back={{ href: `/app/exams/${exam.id}`, label: exam.name }} title="Date sheet"
        chips={<ToneBadge label={STATUS_LABEL[exam.status]} tone={STATUS_TONE[exam.status]} />}
        meta={[exam.status === "draft" ? "Students see it once the exam is scheduled" : "Students can see this date sheet"]} className="pb-8" />
      {sections.length ? (
        <Panel title="Admit cards" className="mb-3">
          <div className="flex flex-wrap gap-2">
            {sections.map((s) => <Button key={s.id} asChild variant="secondary" className="rounded-full"><a href={`/app/exams/${exam.id}/admit-cards/${s.id}`}>{s.label} admit cards</a></Button>)}
          </div>
        </Panel>
      ) : null}
      <DateSheetForm examId={exam.id} groups={groups} clashes={clashes} action={saveDateSheet} editable={canEdit} />
    </>
  );
}
