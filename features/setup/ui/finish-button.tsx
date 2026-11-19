"use client";

import Link from "next/link";
import { finishSetup } from "./actions";
import { StepFooter, useStepRun } from "./wizard";

/** Finish setup, then refresh the review page into the done screen. Disabled with the reason until the year and classes exist. */
export function FinishButton({ ready, back }: { ready: boolean; back: string | null }) {
  const { pending, run } = useStepRun();
  return (
    <>
      <StepFooter back={back} label="Finish setup" pending={pending} disabled={!ready}
        summary={ready ? undefined : <>Add your <Link href="/app/setup/year" className="underline">academic year</Link> and <Link href="/app/setup/classes" className="underline">classes</Link> first</>}
        onClick={() => run(() => finishSetup(), () => false)} />
    </>
  );
}
