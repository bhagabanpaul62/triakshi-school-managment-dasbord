import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { CashAccountService } from "../services/cash";
import { setOpening, transfer } from "./actions";

export const metadata = { title: "Banking" };

export default async function BankingPage() {
  const svc = new CashAccountService(await requireCtx());
  if (!svc.can("reconcile")) notFound();
  const accounts = (await svc.list()).filter((a) => a.isActive);
  const canMove = svc.can("journal"), canSetup = svc.can("settings");
  const options = accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.kind === "cash" ? "cash" : "bank"})` }));
  const today = todayIST();
  const transferFields: Field[] = [
    { name: "fromId", label: "From", type: "select", required: true, options },
    { name: "toId", label: "To", type: "select", required: true, options },
    { name: "amountPaise", label: "Amount", type: "money", required: true },
    { name: "date", label: "Date", type: "date", required: true, max: today },
    { name: "memo", label: "Note", wide: true, hint: "Optional. Like: weekly deposit." },
  ];
  const move = canMove && accounts.length >= 2 ? <FormModal title="Move money" icon="money" fields={transferFields} values={{ date: today }} action={transfer} submitLabel="Move" summary="Posts one entry: money out of one account, into the other." /> : null;

  return (
    <>
      <PageHeader eyebrow="Finance" title="Banking" description="Every cash box and bank account with what it holds." actions={move} />
      {accounts.length === 0 ? (
        <EmptyLine title="No cash or bank account yet." hint={canSetup ? "Add the cash box and the school bank account first." : "Ask an admin to add the cash box and bank account in Finance setup."}
          action={canSetup ? <Link href="/app/finance/settings?tab=cash&next=/app/finance/banking" className="inline-flex h-10 items-center rounded-full bg-[var(--ds-primary)] px-5 text-sm font-medium text-[var(--ds-on-primary)]">Add an account</Link> : undefined} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => (
            <Panel key={a.id} title={a.name} action={<ToneBadge label={a.kind === "cash" ? "Cash" : "Bank"} tone="default" />}>
              <div className="flex flex-col gap-3">
                <Money paise={a.balancePaise} size="xl" tone={a.balancePaise < 0 ? "danger" : "default"} />
                <p className="text-xs text-[var(--ds-on-surface-muted)]">
                  {[a.bankName, a.accountLast4 ? `ending ${a.accountLast4}` : null, a.upiId ? `UPI ${a.upiId}` : null, a.isDefault ? "Default" : null].filter(Boolean).join(" · ") || "No details added."}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/app/finance/accounts/${a.accountId}`} className="inline-flex h-9 items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Ledger</Link>
                  {canMove && !a.openingSet ? (
                    <FormModal title={`Opening balance of ${a.name}`} icon="money" hidden={{ accountId: a.id }} action={setOpening} submitLabel="Set" trigger={{ label: "Set opening balance", variant: "ghost", size: "sm" }}
                      description="What it held when you started using this system. It can be set once."
                      fields={[{ name: "amountPaise", label: "Amount", type: "money", required: true }, { name: "date", label: "As on", type: "date", required: true, max: today }]} values={{ date: today }} />
                  ) : null}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
