import Link from "next/link";
import { redirect } from "next/navigation";
import { BillingService, type ConfirmResult } from "@smw/billing";
import { AppError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Button } from "@smw/ui/ui/button";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { paise, shortDate } from "@smw/ui/format";

export const metadata = { title: "Payment" };

const COPY = {
  paid: { title: "Payment received", body: "Thank you. Your plan is active and the GST invoice is marked paid." },
  pending: { title: "We have not received your payment yet", body: "If you just paid, it can take a minute to arrive. Check again, or come back to billing." },
  failed: { title: "The payment did not go through", body: "You have not been charged for this invoice. You can try again from billing." },
} as const;

/** The gateway sends the browser back here. The redirect proves nothing: we ask the gateway for the order's real status. */
export default async function BillingReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const orderId = Array.isArray(sp.order_id) ? sp.order_id[0] : sp.order_id;
  if (!orderId) redirect("/app/billing");

  const svc = new BillingService(ctx);
  let result: ConfirmResult | null = null;
  let error: string | null = null;
  try {
    result = await svc.confirmOrder(orderId);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    error = err.message;
  }
  const copy = result ? COPY[result.state] : { title: "We could not check this payment", body: error ?? "Please open billing and try again." };

  // Show what was bought, from the school's own records, once the payment is confirmed.
  let receipt: { number: string; total: string; plan: string | null; renews: string | null } | null = null;
  if (result?.state === "paid" && result.invoiceId) {
    const [o, inv] = await Promise.all([svc.overview(), svc.listInvoices()]);
    const row = inv.rows.find((r) => r.id === result!.invoiceId);
    if (row) receipt = { number: row.number, total: paise(row.totalPaise), plan: o.plan?.name ?? null, renews: o.subscription?.periodEnd ? shortDate(o.subscription.periodEnd) : null };
  }
  const retry = result?.state === "pending" ? `/app/billing/return?order_id=${encodeURIComponent(orderId)}` : null;

  return (
    <>
      <PageHeader eyebrow="Billing" title={copy.title} description={copy.body} />
      <div className="max-w-xl">
        <Panel title={receipt ? "Your receipt" : "What next"}>
          {receipt ? (
            <FactList>
              <Fact label="Invoice">{receipt.number}</Fact>
              <Fact label="Paid (incl. GST)">{receipt.total}</Fact>
              {receipt.plan ? <Fact label="Plan">{receipt.plan}</Fact> : null}
              {receipt.renews ? <Fact label="Renews on">{receipt.renews}</Fact> : null}
            </FactList>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {result?.state === "paid" && result.invoiceId ? <Button asChild className="h-10 rounded-full"><a href={`/app/billing/invoices/${result.invoiceId}/pdf`}>Download invoice (PDF)</a></Button> : null}
            {retry ? <Button asChild className="h-10 rounded-full"><Link href={retry}>Check again</Link></Button> : null}
            <Button asChild variant={result?.state === "paid" || retry ? "secondary" : "default"} className="h-10 rounded-full"><Link href="/app/billing">{result?.state === "failed" ? "Try again" : "Back to billing"}</Link></Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
