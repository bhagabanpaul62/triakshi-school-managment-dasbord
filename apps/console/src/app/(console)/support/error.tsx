"use client";

import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

export default function SupportError({ reset }: { error: Error; reset: () => void }) {
  return <WidgetErrorState title="Could not load this page" description="Something went wrong. Nothing was changed. Try again." onRetry={reset} />;
}
