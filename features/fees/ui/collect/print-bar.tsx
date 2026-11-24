"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@smw/ui/ui/button";

/** Opens the print dialog once, with a button to open it again and a way back. */
export function PrintBar({ count }: { count: number }) {
  useEffect(() => { const t = setTimeout(() => window.print(), 600); return () => clearTimeout(t); }, []);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
      <Link href="/app/fees/receipts" className="text-sm text-[var(--ds-on-surface-muted)] underline underline-offset-4">‹ All receipts</Link>
      <p className="text-sm">{count} receipt{count === 1 ? "" : "s"}, one sheet each.</p>
      <Button type="button" className="rounded-full" onClick={() => window.print()}>Print again</Button>
    </div>
  );
}
