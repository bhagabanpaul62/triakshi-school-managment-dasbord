"use client";

import { Panel } from "@smw/ui/kit/Panel";
import { WidgetErrorState, WidgetLoadingSkeleton } from "@smw/ui/widgets/WidgetPrimitives";

const bar = "animate-pulse rounded-full bg-white/[0.06]";

/** Same geometry as the wizard (step rail, then the step panel), so the page does not jump when it arrives. */
export function SetupLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-10 lg:py-12" role="status" aria-label="Loading this step">
      <div className="flex flex-col gap-3 lg:w-72 lg:shrink-0">
        <div className={`${bar} h-3 w-28`} />
        <div className={`${bar} h-5 w-48`} />
        <div className={`${bar} mt-3 h-1.5 w-full`} />
        {/* overflow-hidden: on a phone the 8 pills are wider than the screen and would scroll the whole page sideways. */}
        <div className="mt-3 flex gap-2 overflow-hidden lg:flex-col lg:overflow-visible">{Array.from({ length: 8 }, (_, i) => <div key={i} className={`${bar} h-10 w-32 shrink-0 lg:w-full`} />)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className={`${bar} h-8 w-64`} />
        <div className={`${bar} mt-3 h-3 w-96 max-w-full`} />
        <div className="mt-6"><WidgetLoadingSkeleton height={380} /></div>
      </div>
    </div>
  );
}

export function SetupError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <Panel><WidgetErrorState title="Couldn't load this step" description="Nothing you saved is lost. Try again." onRetry={reset} /></Panel>
    </div>
  );
}
