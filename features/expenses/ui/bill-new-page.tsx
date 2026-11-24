import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { LookupService, VendorService } from "../service";
import { BackLink, NoAccess, can, one, type Search } from "./shared";
import { BillForm } from "./bill-form";

export const metadata = { title: "New bill" };

export default async function NewBillPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "manage")) return <NoAccess ctx={ctx} what="Entering bills" who="accountants and admins" />;
  const sp = await searchParams, look = new LookupService(ctx), vid = one(sp.vendor);
  const [accounts, centres, vehicles, vendor] = await Promise.all([look.accounts(), look.centres(), look.vehicles(), vid ? new VendorService(ctx).get(vid).catch(() => null) : null]);
  return (
    <>
      <BackLink href="/app/expenses/bills">Bills</BackLink>
      <PageHeader eyebrow="Expenses" title="New bill" description="Enter what the vendor billed. Nothing is posted until the bill is approved." />
      <BillForm accounts={accounts} centres={centres} vehicles={vehicles} today={todayIST()} vendor={vendor ? { id: vendor.id, label: vendor.name } : undefined} defaultAccountId={vendor?.defaultAccountId ?? undefined} />
    </>
  );
}
