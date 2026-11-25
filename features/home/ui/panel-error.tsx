"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

/** A failed panel: says what went wrong and retries by re-rendering the page on the server. */
export function PanelError({ message }: { message: string }) {
  const router = useRouter();
  // "Set up the academic year first" is not a glitch to retry: it links to the page that fixes it, and comes back here.
  const year = /academic year/i.test(message);
  return (
    <>
      <WidgetErrorState description={message} onRetry={year ? undefined : () => router.refresh()} />
      {year ? <Link href="/app/academics/years" className="mx-auto mb-2 text-sm text-[var(--ds-color-primary-300)] underline-offset-4 hover:underline">Set up the academic year</Link> : null}
    </>
  );
}
