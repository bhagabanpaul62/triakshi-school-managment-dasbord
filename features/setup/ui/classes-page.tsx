import { redirect } from "next/navigation";
import { CLASS_PRESETS } from "@smw/feature-academics/presets";
import { backHref, nextHref, stepHref } from "../steps";
import { ClassesPicker } from "./classes-picker";
import { SetupFrame, loadWizard } from "./frame";

export const metadata = { title: "Setup: Classes and sections" };

export default async function ClassesStepPage() {
  const { svc, progress } = await loadWizard();
  const { hasYear, existing } = await svc.classesState();
  if (!hasYear) redirect(stepHref("year")); // sections belong to a year
  return (
    <SetupFrame current="classes" progress={progress}>
      <ClassesPicker presets={CLASS_PRESETS} existing={existing} next={nextHref("classes", progress.available)} back={backHref("classes", progress.available)} />
    </SetupFrame>
  );
}
