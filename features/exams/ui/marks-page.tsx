import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { shortDate } from "@smw/ui/format";
import { MarksService } from "../service";
import { saveMarks } from "./actions";
import { MarksGrid } from "./marks-grid";
import { ErrorPanel, STATUS_LABEL, STATUS_TONE, attempt } from "./shared";

export const metadata = { title: "Enter marks" };

export default async function MarksPage({ params }: { params: Promise<{ id: string; paperId: string }> }) {
  const [{ id, paperId }, ctx] = await Promise.all([params, requireCtx()]);
  const loaded = await attempt(() => new MarksService(ctx).sheet(paperId));
  if (!loaded.ok) return <ErrorPanel message={loaded.error} />;
  const sheet = loaded.data;
  if (sheet.paper.examId !== id) notFound();
  const { paper } = sheet;

  return (
    <>
      <EntityHeader
        back={{ href: `/app/exams/${paper.examId}`, label: paper.examName }}
        title={`${paper.className} · ${paper.subjectName}`}
        chips={<ToneBadge label={STATUS_LABEL[paper.status]} tone={STATUS_TONE[paper.status]} />}
        meta={[paper.examName, shortDate(paper.date), `Out of ${paper.maxMarks}`, `Pass at ${paper.passMarks}`]}
        className="pb-8"
      />
      <MarksGrid paperId={paper.id} maxMarks={paper.maxMarks} passMarks={paper.passMarks} rows={sheet.rows} editable={sheet.editable} locked={paper.status === "published"} action={saveMarks} />
    </>
  );
}
