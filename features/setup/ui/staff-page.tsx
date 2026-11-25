import { backHref, nextHref } from "../steps";
import { SetupFrame, loadWizard } from "./frame";
import { StaffInvites } from "./staff-invites";
import { StaffSheet } from "./staff-sheet";

export const metadata = { title: "Setup: Teachers and staff" };

export default async function StaffStepPage() {
  const { progress } = await loadWizard();
  const next = nextHref("staff", progress.available);
  return (
    <SetupFrame current="staff" progress={progress}>
      <StaffSheet existing={progress.facts.teachers} />
      <p className="my-6 text-sm font-medium text-[var(--ds-on-surface)]">Or type them in</p>
      <StaffInvites existing={0} next={next} back={backHref("staff", progress.available)} skip={next} />
    </SetupFrame>
  );
}
