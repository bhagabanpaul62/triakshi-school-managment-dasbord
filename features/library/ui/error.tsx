"use client";

import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

export default function LibraryError({ reset }: { error: Error; reset: () => void }) {
  return <WidgetErrorState title="Couldn't load the library" description="Something went wrong on our side. Try again." onRetry={reset} />;
}
