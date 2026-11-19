"use client";

import { Panel } from "@smw/ui/kit/Panel";
import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

export default function AttendanceError({ reset }: { error: Error; reset: () => void }) {
  return <Panel><WidgetErrorState title="Couldn't load attendance" onRetry={reset} /></Panel>;
}
