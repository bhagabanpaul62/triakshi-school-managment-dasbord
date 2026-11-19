import { backHref, nextHref } from "../steps";
import { SetupFrame, loadWizard } from "./frame";
import { StaffInvites } from "./staff-invites";

export const metadata = { title: "Setup: Teachers" };

export default async function StaffStepPage() {
  const { progress } = await loadWizard();
  const next = nextHref("staff", progress.available);
  return (
    <SetupFrame current="staff" progress={progress}>
      <StaffInvites existing={progress.facts.teachers} next={next} back={backHref("staff", progress.available)} skip={next} />
    </SetupFrame>
  );
}
