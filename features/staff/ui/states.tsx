"use client";

import { Panel } from "@smw/ui/kit/Panel";
import { WidgetErrorState, WidgetLoadingSkeleton } from "@smw/ui/widgets/WidgetPrimitives";

export function StaffLoading() {
  return <WidgetLoadingSkeleton height={420} />;
}

export function StaffError({ reset }: { error: Error; reset: () => void }) {
  return <Panel><WidgetErrorState title="Couldn't load staff" description="Something went wrong on our side. Try again." onRetry={reset} /></Panel>;
}
