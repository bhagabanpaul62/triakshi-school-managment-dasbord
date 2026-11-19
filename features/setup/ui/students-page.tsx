import { backHref, nextHref } from "../steps";
import { SetupFrame, loadWizard } from "./frame";
import { StudentsImport } from "./students-import";

export const metadata = { title: "Setup: Students" };

export default async function StudentsStepPage() {
  const { progress } = await loadWizard();
  const next = nextHref("students", progress.available);
  return (
    <SetupFrame current="students" progress={progress}>
      <StudentsImport existing={progress.facts.students} next={next} back={backHref("students", progress.available)} skip={next} />
    </SetupFrame>
  );
}
