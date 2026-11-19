"use client";

import { Panel } from "@smw/ui/kit/Panel";
import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

/** Inline error with a retry, used as the route's error boundary. */
export default function ErrorPanel({ reset }: { error: Error; reset: () => void }) {
  return (
    <Panel title="Assignments">
      <WidgetErrorState title="Could not load assignments" description="Something went wrong on our side. Try again in a moment." onRetry={reset} />
    </Panel>
  );
}
