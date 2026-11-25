import { backHref, nextHref } from "../steps";
import { SetupFrame, loadWizard } from "./frame";
import { StudentsByHand } from "./students-by-hand";
import { StudentsImport } from "./students-import";

export const metadata = { title: "Setup: Students" };

export default async function StudentsStepPage() {
  const { svc, progress } = await loadWizard();
  const next = nextHref("students", progress.available);
  const sections = await svc.sectionOptions();
  return (
    <SetupFrame current="students" progress={progress}>
      <StudentsImport existing={progress.facts.students} next={next} back={backHref("students", progress.available)} skip={next} />
      {sections.length ? <StudentsByHand sections={sections} /> : null}
    </SetupFrame>
  );
}
