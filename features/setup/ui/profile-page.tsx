import { backHref, nextHref } from "../steps";
import { saveProfile } from "./actions";
import { profileFields } from "./fields";
import { SetupFrame, loadWizard } from "./frame";
import { StepForm } from "./wizard";

export const metadata = { title: "Setup: School profile" };

export default async function ProfileStepPage() {
  const { svc, progress } = await loadWizard();
  const p = await svc.profile();
  const next = nextHref("profile", progress.available);
  return (
    <SetupFrame current="profile" progress={progress}>
      <StepForm fields={profileFields} values={{ ...p }} action={saveProfile} next={next} back={backHref("profile", progress.available)} skip={next} />
    </SetupFrame>
  );
}
