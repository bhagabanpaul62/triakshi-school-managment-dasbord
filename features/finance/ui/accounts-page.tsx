import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { AccountService, type AccountWithBalance } from "../services/accounts";
import { createAccount, deleteAccount, setAccountActive, updateAccount } from "./actions";
import { ACCOUNT_TYPE_LABEL } from "./labels";

export const metadata = { title: "Accounts" };

const typeOptions = Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value, label }));
const createFields: Field[] = [
  { name: "code", label: "Code", required: true, hint: "3 to 6 digits, like 5400." },
  { name: "name", label: "Name", required: true },
  { name: "type", label: "Type", type: "select", required: true, options: typeOptions },
  { name: "group", label: "Group", required: true, hint: "Accounts with the same group sit together, like Office." },
];
const renameOnly: Field[] = [{ name: "name", label: "Name", required: true }, { name: "group", label: "Group", required: true }];

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const svc = new AccountService(await requireCtx());
  if (!svc.can("read")) notFound();
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().toLowerCase() ?? "";
  const canEdit = svc.can("journal");
  const all = await svc.withBalances();
  const accounts = q ? all.filter((a) => `${a.code} ${a.name} ${a.group}`.toLowerCase().includes(q)) : all;
  const byType = (Object.keys(ACCOUNT_TYPE_LABEL) as (keyof typeof ACCOUNT_TYPE_LABEL)[]).map((type) => {
    const rows = accounts.filter((a) => a.type === type), groups = new Map<string, AccountWithBalance[]>();
    for (const a of rows) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
    return { type, groups, total: rows.reduce((s, a) => s + a.shownPaise, 0) };
  }).filter((t) => t.groups.size);

  return (
    <>
      <PageHeader eyebrow="Finance" title="Accounts" description="The chart every entry posts to. Fees, expenses and payroll use the system accounts; add your own for anything else."
        actions={canEdit ? <FormModal title="New account" icon="book" fields={createFields} action={createAccount} submitLabel="Add" /> : null} />
      <form method="get" role="search" className="pb-6">
        <label className="sr-only" htmlFor="account-q">Search accounts</label>
        <input id="account-q" name="q" defaultValue={q} placeholder="Search by code or name" className="h-10 w-full max-w-sm rounded-full bg-white/[0.05] px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]" />
      </form>
      {byType.length === 0 ? <EmptyLine title="No account matches." hint="Try another word." /> : (
        <div className="flex flex-col gap-3">
          {byType.map(({ type, groups, total }) => (
            <Panel key={type} title={ACCOUNT_TYPE_LABEL[type]} action={<Money paise={total} />}>
              <div className="flex flex-col gap-5">
                {[...groups].map(([group, rows]) => (
                  <section key={group} aria-label={group}>
                    <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{group}</h3>
                    <ul className="flex flex-col">
                      {rows.map((a) => (
                        <li key={a.id} className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-1 text-sm hover:bg-white/[0.04]">
                          <span className="w-12 shrink-0 font-mono text-xs text-[var(--ds-on-surface-muted)]">{a.code}</span>
                          <Link href={`/app/finance/accounts/${a.id}`} className="min-w-0 flex-1 truncate hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">{a.name}</Link>
                          {!a.isActive ? <ToneBadge label="Off" tone="default" /> : null}
                          <Money paise={a.shownPaise} className="w-28" />
                          {canEdit ? (
                            <span className="inline-flex items-center gap-1">
                              <FormModal title={`Edit ${a.name}`} icon="book" fields={a.systemKey ? renameOnly : createFields} values={a} hidden={{ id: a.id }} action={updateAccount} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
                              {!a.systemKey ? (
                                <>
                                  <ActionButton variant="ghost" label={a.isActive ? "Switch off" : "Switch on"} action={setAccountActive} values={{ id: a.id, active: a.isActive ? "0" : "1" }} />
                                  {a.balancePaise === 0 ? <ActionButton variant="icon-delete" label={`Delete ${a.name}`} action={deleteAccount} values={{ id: a.id }} confirm={{ title: `Delete ${a.name}?`, body: "Only possible while it has no entries. This cannot be undone.", confirmLabel: "Delete", danger: true }} /> : null}
                                </>
                              ) : null}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
