import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ExamService, RemarkService } from "../service";
import { saveRemarks } from "./actions";
import { QueryPicker, RemarksSheet } from "./sheets";
import { ErrorPanel, attempt } from "./shared";

export const metadata = { title: "Report card remarks" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The class teacher's remarks for every student of a section, one term at a time. Printed on the report card. */
export default async function RemarksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, ctx] = await Promise.all([searchParams, requireCtx()]);
  const svc = new RemarkService(ctx);
  const loaded = await attempt(async () => {
    const [sectionList, options] = await Promise.all([svc.sections(), new ExamService(ctx).formOptions()]);
    const sectionId = one(sp.sectionId) ?? (sectionList.length === 1 ? sectionList[0]!.id : undefined);
    const termId = one(sp.termId) ?? options.terms[0]?.value;
    return { sectionList, terms: options.terms, sectionId, termId, sheet: sectionId && termId ? await svc.sheet(sectionId, termId) : null };
  });
  if (!loaded.ok) return <ErrorPanel message={loaded.error} />;
  const { sectionList, terms, sectionId, termId, sheet } = loaded.data;
  return (
    <>
      <PageHeader eyebrow="Academics" title="Report card remarks" description="Write a line for each student. It prints on their term report card." />
      <QueryPicker path="/app/exams/remarks" picks={[
        { name: "sectionId", label: "Section", value: sectionId, options: sectionList.map((s) => ({ value: s.id, label: s.label })) },
        { name: "termId", label: "Term", value: termId, options: terms },
      ]} />
      {sheet ? <RemarksSheet key={`${sheet.section.id}:${sheet.term.id}`} sectionId={sheet.section.id} termId={sheet.term.id} rows={sheet.rows} action={saveRemarks} />
        : <Panel><WidgetEmptyState title={sectionList.length ? "Pick a section and a term." : "No sections to write for."} description={sectionList.length ? "The students show here." : "Only the class teacher of a section (or an admin) can write remarks."} /></Panel>}
    </>
  );
}
