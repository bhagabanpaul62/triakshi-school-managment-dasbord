import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ExamService, MarksService, RemarkService } from "../service";
import { saveCoScholastic } from "./actions";
import { CoGrid, QueryPicker } from "./sheets";
import { ErrorPanel, attempt } from "./shared";

export const metadata = { title: "Co-scholastic grades" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Pick a section and a term, then a grade per student per co-scholastic area. Class teacher or admin. */
export default async function CoScholasticPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, ctx] = await Promise.all([searchParams, requireCtx()]);
  const loaded = await attempt(async () => {
    const [sectionList, options] = await Promise.all([new RemarkService(ctx).sections(), new ExamService(ctx).formOptions()]);
    const sectionId = one(sp.sectionId) ?? (sectionList.length === 1 ? sectionList[0]!.id : undefined);
    const termId = one(sp.termId) ?? options.terms[0]?.value;
    return { sectionList, terms: options.terms, sectionId, termId, sheet: sectionId && termId ? await new MarksService(ctx).coSheet(sectionId, termId) : null };
  });
  if (!loaded.ok) return <ErrorPanel message={loaded.error} />;
  const { sectionList, terms, sectionId, termId, sheet } = loaded.data;
  return (
    <>
      <PageHeader eyebrow="Academics" title="Co-scholastic grades" description="Art, work education, health and discipline: one grade per student per term. Each pick saves at once." />
      <QueryPicker path="/app/exams/co-scholastic" picks={[
        { name: "sectionId", label: "Section", value: sectionId, options: sectionList.map((s) => ({ value: s.id, label: s.label })) },
        { name: "termId", label: "Term", value: termId, options: terms },
      ]} />
      {sheet ? <CoGrid key={`${sheet.section.id}:${sheet.term.id}`} termId={sheet.term.id} subjects={sheet.subjects} grades={sheet.grades} students={sheet.students} action={saveCoScholastic} editable />
        : <Panel><WidgetEmptyState title={sectionList.length ? "Pick a section and a term." : "No sections to grade."} description={sectionList.length ? "The students and co-scholastic areas show here." : "Only the class teacher of a section (or an admin) can enter these grades."} /></Panel>}
    </>
  );
}
