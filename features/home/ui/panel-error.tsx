"use client";

import { useRouter } from "next/navigation";
import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

/** A failed panel: says what went wrong and retries by re-rendering the page on the server. */
export function PanelError({ message }: { message: string }) {
  const router = useRouter();
  return <WidgetErrorState description={message} onRetry={() => router.refresh()} />;
}
