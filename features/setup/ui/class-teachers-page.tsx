import { backHref, nextHref } from "../steps";
import { ClassTeachers } from "./class-teachers";
import { SetupFrame, loadWizard } from "./frame";

export const metadata = { title: "Setup: Class teachers" };

export default async function ClassTeachersStepPage() {
  const { svc, progress } = await loadWizard();
  const s = await svc.classTeacherState();
  const next = nextHref("classteachers", progress.available);
  return (
    <SetupFrame current="classteachers" progress={progress}>
      <ClassTeachers sections={s.sections} teachers={s.teachers} next={next} back={backHref("classteachers", progress.available)} skip={next} />
    </SetupFrame>
  );
}
