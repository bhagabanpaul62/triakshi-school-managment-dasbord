"use client";

import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

export default function GettingStartedError({ reset }: { error: Error; reset: () => void }) {
  return <WidgetErrorState title="Couldn't load getting started" description="Something went wrong on our side. Nothing you did is lost. Try again." onRetry={reset} />;
}
