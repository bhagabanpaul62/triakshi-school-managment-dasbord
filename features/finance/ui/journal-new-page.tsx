import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { EmptyLine } from "@smw/ui/finance/States";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { AccountService } from "../services/accounts";
import { CostCentreService } from "../services/accounts";
import { OWNED_BY_MODULES } from "../services/journals";
import { proposeJournal } from "./actions";
import { JournalEditor } from "./journal-editor";

export const metadata = { title: "New journal entry" };

export default async function NewJournalPage() {
  const ctx = await requireCtx();
  const accounts = new AccountService(ctx);
  if (!accounts.can("journal")) notFound();
  const [all, centres] = await Promise.all([accounts.withBalances(), new CostCentreService(ctx).list({ pageSize: 100 })]);
  const usable = all.filter((a) => a.isActive && !(a.systemKey && OWNED_BY_MODULES.includes(a.systemKey)));
  return (
    <>
      <PageHeader eyebrow="Journal entries" title="New journal entry" description="For things no other screen posts, like a gift in kind or a correction. Nothing posts until another person approves it." />
      {usable.length < 2 ? <EmptyLine title="There are not enough accounts yet." hint="Add accounts under Finance, Accounts." /> : (
        <JournalEditor accounts={usable.map((a) => ({ id: a.id, code: a.code, name: a.name, group: a.group }))} centres={centres.rows.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }))} today={todayIST()} action={proposeJournal} backTo="/app/finance/journals" />
      )}
    </>
  );
}
