"use client";

import { useEffect, useState } from "react";
import { Button } from "@smw/ui/ui/button";

type CashfreeSdk = { checkout(o: { paymentSessionId: string; redirectTarget: "_self" }): Promise<unknown>; subscriptionsCheckout?(o: { subscriptionsSessionId: string; redirectTarget: "_self" }): Promise<unknown> };
declare global { interface Window { Cashfree?: (o: { mode: "sandbox" | "production" }) => CashfreeSdk } }

const SDK = "https://sdk.cashfree.com/js/v3/cashfree.js";

/** Loads Cashfree's JS SDK and opens its hosted checkout for a payment session. */
export function CashfreeCheckout({ session, mode, kind }: { session: string; mode: "sandbox" | "production"; kind: "order" | "subscription" }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const open = () => {
      if (cancelled) return;
      try {
        const cf = window.Cashfree?.({ mode });
        if (!cf) throw new Error("sdk missing");
        // verify against Cashfree docs: subscriptionsCheckout is the documented SDK call for subscription sessions.
        if (kind === "subscription" && cf.subscriptionsCheckout) void cf.subscriptionsCheckout({ subscriptionsSessionId: session, redirectTarget: "_self" });
        else void cf.checkout({ paymentSessionId: session, redirectTarget: "_self" });
      } catch { setFailed(true); }
    };
    if (window.Cashfree) { open(); return () => { cancelled = true; }; }
    const s = document.createElement("script");
    s.src = SDK; s.async = true; s.onload = open; s.onerror = () => !cancelled && setFailed(true);
    document.head.appendChild(s);
    return () => { cancelled = true; s.remove(); };
  }, [session, mode, kind, attempt]);

  return failed ? (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-[var(--ds-on-surface-variant)]">We could not open the payment page. Check your connection and try again.</p>
      <Button type="button" className="rounded-full" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>Try again</Button>
    </div>
  ) : <p className="text-sm text-[var(--ds-on-surface-variant)]" role="status">Taking you to the secure payment page...</p>;
}
