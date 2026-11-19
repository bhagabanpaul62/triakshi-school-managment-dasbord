"use client";

import { useEffect } from "react";
import { Button } from "@smw/ui/ui/button";

// A page failed on the server: say so plainly, keep the shell, offer a retry. Details go to the server log only.
export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section role="alert" className="mt-8 max-w-lg rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
      <h1 className="text-xl font-medium tracking-tight">This page could not load</h1>
      <p className="mt-2 text-sm text-[var(--ds-on-surface-muted)]">Something went wrong on our side. Try again; if it keeps happening, raise a ticket from Support{error.digest ? ` and mention code ${error.digest}` : ""}.</p>
      <div className="mt-6 flex gap-2">
        <Button onClick={reset} className="rounded-full">Try again</Button>
        <Button variant="secondary" className="rounded-full" onClick={() => (window.location.href = "/app")}>Go home</Button>
      </div>
    </section>
  );
}
