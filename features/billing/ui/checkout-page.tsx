import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { CashfreeCheckout } from "./cashfree-checkout";

export const metadata = { title: "Payment" };

/** Hosts Cashfree's JS checkout. It lives in the school app (not the console) so the school admin reaches it without a console login. */
export default async function BillingCheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCtx();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const session = one(sp.session);
  if (!session || session.length > 400) redirect("/app/billing");
  const mode = one(sp.mode) === "production" ? "production" : "sandbox";
  const kind = one(sp.kind) === "subscription" ? "subscription" : "order";
  return (
    <>
      <PageHeader eyebrow="Billing" title="Secure payment" description="You will complete the payment on our payment partner's page." />
      <Panel>
        <CashfreeCheckout session={session} mode={mode} kind={kind} />
        <p className="mt-5 text-xs text-[var(--ds-on-surface-muted)]">Changed your mind? <Link href="/app/billing" className="text-[var(--ds-color-primary-400)] hover:underline">Go back to billing</Link>. You are only charged when the payment completes.</p>
      </Panel>
    </>
  );
}
