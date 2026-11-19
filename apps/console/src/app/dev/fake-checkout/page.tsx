import { notFound } from "next/navigation";
import { DevCheckout } from "@smw/billing";
import { fakePayments } from "@smw/config";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { paise } from "@smw/ui/format";

export const metadata = { title: "Test checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Stand-in for Cashfree's hosted checkout when no keys are set. Never exists in production. */
export default async function FakeCheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fakePayments()) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const order = one(sp.order), back = one(sp.return);
  if (!order || !back) notFound();
  const pay = await DevCheckout.order(order).catch(() => notFound());

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">Test mode, no money moves</p>
      <Panel title="Pay Triakshi">
        <p className="text-[34px] font-medium leading-none tabular-nums tracking-tight">{paise(pay.amountPaise)}</p>
        <p className="mt-2 text-sm text-[var(--ds-on-surface-variant)]">This is the local stand-in for the Cashfree payment page.</p>
        <form action="/dev/fake-pay" method="post" className="mt-6 flex flex-wrap gap-2">
          <input type="hidden" name="order" value={order} />
          <input type="hidden" name="return" value={back} />
          <Button type="submit" name="outcome" value="pay" className="rounded-full">Pay (test)</Button>
          <Button type="submit" name="outcome" value="fail" variant="secondary" className="rounded-full">Fail (test)</Button>
        </form>
      </Panel>
    </main>
  );
}
