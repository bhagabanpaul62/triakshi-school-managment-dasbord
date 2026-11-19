import { shortDate } from "@smw/ui/format";
import { backHref, nextHref } from "../steps";
import { saveYear } from "./actions";
import { yearFields } from "./fields";
import { SetupFrame, loadWizard } from "./frame";
import { StepForm } from "./wizard";

export const metadata = { title: "Setup: Academic year" };

export default async function YearStepPage() {
  const { svc, progress } = await loadWizard();
  const { current, termCount, suggested } = await svc.yearState();
  const day = (d: string) => shortDate(`${d}T00:00:00+05:30`);
  const fields = yearFields({ suggestedStart: day(suggested.startsOn), suggestedEnd: day(suggested.endsOn), hasTerms: termCount > 0 });
  return (
    <SetupFrame current="year" progress={progress}>
      <StepForm fields={fields} values={current ? { name: current.name, startsOn: current.startsOn, endsOn: current.endsOn } : { name: suggested.name, terms: "2" }}
        action={saveYear} next={nextHref("year", progress.available)} back={backHref("year", progress.available)} />
    </SetupFrame>
  );
}
