"use client";

import { useEffect } from "react";
import { ErrorLine } from "@smw/ui/finance/States";

/** Every Website screen shares this: say it failed, offer a retry, log the detail. */
export default function WebsiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section className="pt-8">
      <ErrorLine message={`This page could not load${error.digest ? ` (code ${error.digest})` : ""}. Nothing you saved is lost.`} retry={reset} />
    </section>
  );
}
