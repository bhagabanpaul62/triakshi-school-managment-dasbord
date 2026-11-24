"use client";

import { useState, useTransition } from "react";
import { Button } from "@smw/ui/ui/button";
import { CopyValue } from "@smw/ui/finance/CopyValue";
import { revealVendor } from "./actions";

/** Shows the full PAN and bank number after one deliberate click. Every click is written to the audit log. */
export function VendorReveal({ id }: { id: string }) {
  const [data, setData] = useState<{ pan: string | null; bankAccount: string | null } | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (data) return <div className="flex flex-col gap-1 text-sm"><span>PAN: {data.pan ? <CopyValue value={data.pan} label="PAN" /> : "not saved"}</span><span>Account: {data.bankAccount ? <CopyValue value={data.bankAccount} label="account number" /> : "not saved"}</span></div>;
  return <div><Button type="button" variant="ghost" className="rounded-full" isLoading={pending} onClick={() => start(async () => { const r = await revealVendor(id); if (r.ok) setData(r.data); else setError(r.error); })}>Show full PAN and account</Button>
    <p className="px-2 text-xs text-[var(--ds-on-surface-muted)]">Viewing is recorded in the audit log.</p>{error ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{error}</p> : null}</div>;
}
