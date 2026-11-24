import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import { BillService, LookupService, VendorService } from "../service";
import { BackLink, NoAccess, Notice, can, one, type Search } from "./shared";
import { PaymentForm } from "./payment-form";
import { VendorGo } from "./vendor-go";

export const metadata = { title: "Pay a vendor" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "manage")) return <NoAccess ctx={ctx} what="Paying vendors" who="accountants and admins" />;
  const sp = await searchParams, bills = new BillService(ctx);
  const chosen = one(sp.bills).split(",").filter(Boolean);
  let vendorId = one(sp.vendor);
  if (!vendorId && chosen[0]) vendorId = (await bills.get(chosen[0]).catch(() => null))?.bill.vendorId ?? "";
  const head = <><BackLink href="/app/expenses/payments">Payments</BackLink><PageHeader eyebrow="Expenses" title="Pay a vendor" description="Pay one or many approved bills in one payment. Part payments are fine." /></>;
  if (!vendorId) return <>{head}<div className="max-w-xl rounded-3xl bg-[var(--ds-surface-container-low)] p-6"><VendorGo /><p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Or select bills on the <Link href="/app/expenses/bills?status=unpaid" className="underline underline-offset-4">unpaid bills</Link> list and press Pay selected.</p></div></>;
  const [vendor, open, cash] = await Promise.all([new VendorService(ctx).get(vendorId), bills.openFor(vendorId), new LookupService(ctx).cashAccounts()]);
  const skipped = chosen.length - open.filter((b) => chosen.includes(b.id)).length;
  return (
    <>
      {head}
      {skipped > 0 ? <Notice tone="info">{skipped} of the chosen bills cannot be paid now: they are not approved yet, already paid, or belong to another vendor. They are left out.</Notice> : null}
      {open.length ? <PaymentForm vendor={{ id: vendor.id, name: vendor.name, hasBank: vendor.hasBank }} open={open} chosen={chosen} cashAccounts={cash} today={todayIST()} />
        : <Notice action={{ href: `/app/expenses/bills?status=pending`, label: "See bills waiting" }}>{vendor.name} has no approved bill that is waiting for money. A bill can be paid once approved.</Notice>}
      <Link href={`/app/expenses/vendors/${vendor.id}`} className={`${buttonVariants({ variant: "ghost", className: "mt-4 rounded-full" })}`}>Open {vendor.name}</Link>
    </>
  );
}
