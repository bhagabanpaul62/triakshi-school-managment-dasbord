"use client";

import { useEffect } from "react";
import { ErrorLine } from "@smw/ui/finance/States";

export default function DomainsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <section className="pt-8"><ErrorLine message={`Domains could not load${error.digest ? ` (code ${error.digest})` : ""}.`} retry={reset} /></section>;
}
