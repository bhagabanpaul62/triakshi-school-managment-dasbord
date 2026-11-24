import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { todayIST } from "@smw/feature-kit/money";
import { ExitService } from "../services/exits";
import { ProfileService } from "../services/profiles";
import { createExit } from "./actions";
import { NoAccess, PayNav, one, type Search } from "./common";
import { RedirectForm } from "./redirect-form";

export const metadata = { title: "Start an exit" };

export default async function NewExitPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!new ExitService(ctx).can("manage")) return <NoAccess what="Starting an exit" />;
  const people = (await new ProfileService(ctx).all()).filter((p) => p.hasAssignment);
  const user = one((await searchParams).user);
  return (
    <>
      <Link href="/app/payroll/exits" className="mb-2 inline-block text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">Exits</Link>
      <PageHeader eyebrow="Payroll" title="Start an exit" description="You see every line of the settlement before it goes for approval." />
      <PayNav active="exits" manager />
      <RedirectForm hrefPrefix="/app/payroll/exits/" action={createExit} submitLabel="Work out the settlement" values={{ userId: user, lastDay: todayIST(), noticeDays: 0 }}
        fields={[
          { name: "userId", label: "Person", type: "select", required: true, options: people.map((p) => ({ value: p.id, label: `${p.name} (${p.employeeId})` })), hint: people.length ? undefined : "Only people with pay set up can leave through payroll." },
          { name: "lastDay", label: "Last working day", type: "date", required: true }, { name: "reason", label: "Why they are leaving", type: "text", required: true },
          { name: "noticeDays", label: "Notice days", type: "number", hint: "More than zero: the school pays in place of notice. Less than zero: the person did not serve this many days.", step: 1 },
        ]} />
    </>
  );
}
