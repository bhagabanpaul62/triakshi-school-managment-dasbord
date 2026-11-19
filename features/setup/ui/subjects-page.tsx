import { redirect } from "next/navigation";
import { backHref, nextHref, stepHref } from "../steps";
import { SetupFrame, loadWizard } from "./frame";
import { SubjectsMatrix } from "./subjects-matrix";

export const metadata = { title: "Setup: Subjects" };

export default async function SubjectsStepPage() {
  const { svc, progress } = await loadWizard();
  if (!progress.facts.classes) redirect(stepHref("classes")); // subjects are assigned to classes
  const s = await svc.subjectsState();
  return (
    <SetupFrame current="subjects" progress={progress}>
      <SubjectsMatrix board={s.board} bandCounts={s.bandCounts} assigned={s.assigned} next={nextHref("subjects", progress.available)}
        back={backHref("subjects", progress.available)} skip={nextHref("subjects", progress.available)} />
    </SetupFrame>
  );
}
