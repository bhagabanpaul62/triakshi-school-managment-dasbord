"use client";

import { Panel } from "@smw/ui/kit/Panel";
import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

export default function SettingsError({ reset }: { error: Error; reset: () => void }) {
  return <Panel><WidgetErrorState title="Couldn't load this page" onRetry={reset} /></Panel>;
}
