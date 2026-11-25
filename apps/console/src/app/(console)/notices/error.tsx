"use client";

import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

export default function NoticesError({ reset }: { error: Error; reset: () => void }) {
  return <WidgetErrorState title="Could not load the notices" description="Something went wrong. Nothing was changed. Try again." onRetry={reset} />;
}
