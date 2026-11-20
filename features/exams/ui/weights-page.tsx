import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { shortDate } from "@smw/ui/format";
import { TermWeightService } from "../service";
import { saveWeights } from "./actions";
import { WeightsEditor } from "./setup-editors";
import { ErrorPanel, attempt } from "./shared";

export const metadata = { title: "Term weights" };

/** How much each exam counts in its term, e.g. unit test 10, notebook 5, half yearly 80. Must add up to 100. */
export default async function WeightsPage() {
  const svc = new TermWeightService(await requireCtx());
  const loaded = await attempt(() => svc.overview());
  if (!loaded.ok) return <ErrorPanel message={loaded.error} />;
  const canEdit = svc.can("manage");
  return (
    <>
      <PageHeader eyebrow="Academics" title="Term weights" description="Set how much each exam counts in its term. Give an exam a term when you create it. Weights must add up to 100." />
      <div className="flex flex-col gap-3">
        {loaded.data.length === 0 ? <Panel><WidgetEmptyState title="No terms yet." description="Add terms to the academic year first." /></Panel> : null}
        {loaded.data.map(({ term, exams }) => (
          <Panel key={term.id} title={`${term.name} · ${shortDate(term.startsOn)} to ${shortDate(term.endsOn)}`}>
            {exams.length === 0 ? <WidgetEmptyState title="No exams in this term." description="Pick this term when creating an exam." /> : <WeightsEditor termId={term.id} exams={exams} action={saveWeights} canEdit={canEdit} />}
          </Panel>
        ))}
      </div>
    </>
  );
}
