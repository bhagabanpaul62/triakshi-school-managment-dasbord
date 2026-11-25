import { NoAccess } from "@smw/ui/shell/NoAccess";
import { requireCtx } from "@smw/runtime";
import { shortDate } from "@smw/ui/format";

export const metadata = { title: "Not available" };

/** Where a student who left lands on any page outside fees, results and notifications: a plain reason and the way home, never an error. */
export default async function NotAvailablePage() {
  const ctx = await requireCtx();
  return (
    <NoAccess
      title="This page is not open to a student who has left the school."
      hint={ctx.leftUntil ? `You can still use dues and receipts and results until ${shortDate(ctx.leftUntil)}. For anything else, ask the school office.` : "Ask the school office."}
    />
  );
}
