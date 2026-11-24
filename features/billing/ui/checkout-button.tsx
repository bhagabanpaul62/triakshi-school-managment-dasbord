"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import { shortDate } from "@smw/ui/format";
import type { FormResult } from "@smw/ui/shell/FormModal";

/** Runs a checkout server action, then sends the browser to the payment page (or confirms a scheduled downgrade). */
export function CheckoutButton({ action, values, label, variant = "default", disabled, className }: {
  action: (fd: FormData) => Promise<FormResult>;
  values: Record<string, string>;
  label: string;
  variant?: "default" | "secondary" | "ghost";
  disabled?: boolean;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = () => start(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    const r = await action(fd);
    if (!r.ok) { toast(r.error, "danger"); return; }
    const d = r.data as { kind?: string; checkoutUrl?: string; planName?: string; effectiveAt?: string } | undefined;
    if (d?.kind === "paid") { toast("Paid from your account credit. Nothing more to pay."); router.refresh(); return; }
    if (d?.kind === "checkout" && d.checkoutUrl) { window.location.assign(d.checkoutUrl); return; }
    if (d?.kind === "scheduled") { toast(`${d.planName} will start at your next renewal on ${shortDate(d.effectiveAt)}.`); router.refresh(); }
  });
  // h-10 keeps the tap target at 40px even where the page asks for a compact button.
  return <Button type="button" variant={variant} className={`h-10 rounded-full ${className ?? ""}`} isLoading={pending} disabled={disabled} onClick={run}>{label}</Button>;
}
