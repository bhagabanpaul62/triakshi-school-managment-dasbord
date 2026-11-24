"use client";

import { useEffect } from "react";
import { ErrorLine } from "@smw/ui/finance/States";

/** Billing pages share this: say it failed, offer a retry, log the detail. */
export default function BillingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section className="pt-8">
      <ErrorLine message={`Billing could not load${error.digest ? ` (code ${error.digest})` : ""}. Your plan and payments are safe.`} retry={reset} />
    </section>
  );
}
