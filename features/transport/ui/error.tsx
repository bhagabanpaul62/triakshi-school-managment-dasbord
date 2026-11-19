"use client";

import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

export default function TransportError({ reset }: { error: Error; reset: () => void }) {
  return <WidgetErrorState title="Couldn't load transport" description="Something went wrong on our side. Try again." onRetry={reset} />;
}
