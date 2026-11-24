import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { OpeningForm } from "./opening-form";
import { BackLink, NoAccess, can } from "./shared";

export const metadata = { title: "Opening balances" };

export default async function OpeningPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "setup")) return <NoAccess what="Opening balances" who="accountants and admins" home="/app/fees" />;
  return (
    <>
      <BackLink href="/app/fees/invoices">Bills</BackLink>
      <PageHeader eyebrow="Fees" title="Opening balances" description="Bring in what families owe, and the advance and deposit they hold, from the system you used before." />
      <OpeningForm />
    </>
  );
}
