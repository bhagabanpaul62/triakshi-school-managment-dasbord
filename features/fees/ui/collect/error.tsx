"use client";

import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

export default function FeesError({ reset }: { error: Error; reset: () => void }) {
  return <WidgetErrorState title="Couldn't load this page" description="Something went wrong on our side. Nothing you entered was lost. Try again." onRetry={reset} />;
}
