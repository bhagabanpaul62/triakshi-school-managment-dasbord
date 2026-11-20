import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { shortDate } from "@smw/ui/format";
import { MarksService } from "../service";
import { saveComponents, saveMarks } from "./actions";
import { MarksGrid } from "./marks-grid";
import { ComponentsEditor } from "./setup-editors";
import { ErrorPanel, STATUS_LABEL, STATUS_TONE, attempt } from "./shared";

export const metadata = { title: "Enter marks" };

export default async function MarksPage({ params }: { params: Promise<{ id: string; paperId: string }> }) {
  const [{ id, paperId }, ctx] = await Promise.all([params, requireCtx()]);
  const loaded = await attempt(() => new MarksService(ctx).sheet(paperId));
  if (!loaded.ok) return <ErrorPanel message={loaded.error} />;
  const sheet = loaded.data;
  if (sheet.paper.examId !== id) notFound();
  const { paper } = sheet;
  const homework = sheet.editable && sheet.components.length && ctx.features.has("assignments") ? await new MarksService(ctx).homeworkMarks(paperId).catch((err) => { console.error(JSON.stringify({ level: "error", msg: "homework marks failed", paperId, err: String(err) })); return {}; }) : {};
  const canSplit = new MarksService(ctx).can("manage") && paper.status !== "published" && sheet.rows.every((r) => r.marks === null && !r.absent);

  return (
    <>
      <EntityHeader
        back={{ href: `/app/exams/${paper.examId}`, label: paper.examName }}
        title={`${paper.className} · ${paper.subjectName}`}
        chips={<ToneBadge label={STATUS_LABEL[paper.status]} tone={STATUS_TONE[paper.status]} />}
        meta={[paper.examName, shortDate(paper.date), `Out of ${paper.maxMarks}`, `Pass at ${paper.passMarks}`]}
        className="pb-8"
      />
      {canSplit ? <ComponentsEditor key={sheet.components.map((c) => c.id).join()} paperId={paper.id} components={sheet.components} action={saveComponents} /> : null}
      <MarksGrid key={sheet.components.map((c) => c.id).join()} paperId={paper.id} maxMarks={paper.maxMarks} passMarks={paper.passMarks} rows={sheet.rows} components={sheet.components} editable={sheet.editable} locked={paper.status === "published"} action={saveMarks} homework={homework} />
    </>
  );
}
