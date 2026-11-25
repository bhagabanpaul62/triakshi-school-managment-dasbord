"use client";

import { Panel } from "@smw/ui/kit/Panel";
import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

/** The route's error boundary: says what failed and offers a retry. Anything typed in a form lives in the browser and is not lost. */
export default function ErrorPanel({ reset }: { error: Error; reset: () => void }) {
  return (
    <Panel title="Notices">
      <WidgetErrorState title="Could not load notices" description="Something went wrong on our side. Try again in a moment." onRetry={reset} />
    </Panel>
  );
}
