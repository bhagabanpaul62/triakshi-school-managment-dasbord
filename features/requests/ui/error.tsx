"use client";

import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

export default function RequestsError({ reset }: { error: Error; reset: () => void }) {
  return <WidgetErrorState title="Couldn't load requests" description="Something went wrong on our side. Nothing you typed was lost. Try again." onRetry={reset} />;
}
