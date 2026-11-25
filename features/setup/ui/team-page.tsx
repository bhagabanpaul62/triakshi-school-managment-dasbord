import { backHref, nextHref } from "../steps";
import { SetupFrame, loadWizard } from "./frame";
import { TeamStep } from "./team-step";

export const metadata = { title: "Setup: Your team" };

export default async function TeamStepPage() {
  const { svc, progress } = await loadWizard();
  const team = await svc.team();
  return (
    <SetupFrame current="team" progress={progress}>
      <TeamStep team={team} next={nextHref("team", progress.available)} back={backHref("team", progress.available)} skip={nextHref("team", progress.available)} />
    </SetupFrame>
  );
}
