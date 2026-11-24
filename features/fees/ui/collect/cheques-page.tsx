import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { rupees } from "@smw/feature-kit/money";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { buttonVariants } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { ChequeService, DeskService } from "../../service";
import { bounceCheque, clearCheque, depositCheque, depositCheques } from "../collect-actions";
import { DeskNav, NoAccess, Notice, NoticeLink, Ref, can, day } from "./shared";

export const metadata = { title: "Cheques" };

const COLUMNS = [["received", "Received", "In hand, not yet at the bank"], ["deposited", "Deposited", "At the bank, waiting to clear"], ["cleared", "Cleared", "Money is in the bank"], ["bounced", "Bounced", "Returned: the bills are open again"]] as const;

export default async function ChequesPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "collect")) return <NoAccess what="The cheque register" who="cashiers, accountants and admins" />;
  const [board, config] = await Promise.all([new ChequeService(ctx).board(), new DeskService(ctx).config()]);
  const today = config.today;
  const ready = board.received.rows.filter((r) => r.cheque.chequeDate <= today);
  const held = board.received.rows.length - ready.length;
  const any = COLUMNS.some(([k]) => board[k].rows.length);
  const noBank = config.banks.length === 0;

  return (
    <>
      <PageHeader eyebrow="Fees" title="Cheques" description="Every cheque from the day it is received to the day it clears or bounces. Post-dated cheques wait for their date."
        actions={ready.length ? (
          <>
            <Link href={`/app/fees/cheques/slip?ids=${ready.map((r) => r.cheque.id).join(",")}`} target="_blank" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Deposit slip ({ready.length})</Link>
            {!noBank ? <FormModal title={`Mark ${ready.length} cheque${ready.length === 1 ? "" : "s"} as deposited`} description="Use this after you hand the slip and cheques to the bank." icon="money" action={depositCheques} submitLabel="Mark deposited"
              hidden={{ ids: ready.map((r) => r.cheque.id).join(",") }} values={{ date: today }} trigger={{ label: "Mark all deposited", plus: false }}
              fields={[{ name: "cashAccountId", label: "Deposited in", type: "select", required: true, options: config.banks.map((b) => ({ value: b.id, label: b.name })) }, { name: "date", label: "Date", type: "date", max: today }]} /> : null}
          </>
        ) : undefined} />
      <DeskNav ctx={ctx} current="/app/fees/cheques" />
      {noBank ? <Notice action={<NoticeLink href="/app/finance/accounts?next=/app/fees/cheques">Add a bank account</NoticeLink>}>There is no bank account yet, so a cheque cannot be marked deposited.</Notice> : null}
      {held ? <Notice tone="info">{held} post-dated cheque{held === 1 ? " is" : "s are"} held until {held === 1 ? "its" : "their"} date and {held === 1 ? "is" : "are"} greyed out below.</Notice> : null}
      {!any ? (
        <EmptyLine title="No cheques yet." hint="A cheque appears here when you take one at the counter (a cheque is taken in its own receipt)." action={<Link href="/app/fees/collect" className={buttonVariants({ className: "rounded-full" })}>Collect fees</Link>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-4">
          {COLUMNS.map(([key, label, hint]) => {
            const col = board[key], t = board.totals[key] ?? { count: 0, paise: 0 };
            return (
              <section key={key} aria-label={label} className="flex min-w-0 flex-col gap-2 rounded-3xl bg-[var(--ds-surface-container-low)] p-4">
                <header className="mb-1">
                  <h2 className="flex items-center justify-between gap-2 text-sm font-medium"><span className="flex items-center gap-2">{label}<StateBadge state={key} /></span><span className="text-xs text-[var(--ds-on-surface-muted)]">{t.count}</span></h2>
                  <p className="mt-1"><Money paise={t.paise} size="lg" /></p>
                  <p className="text-xs text-[var(--ds-on-surface-muted)]">{hint}</p>
                </header>
                {col.rows.length ? col.rows.map(({ cheque: c, studentId, studentName }) => {
                  const postDated = key === "received" && c.chequeDate > today;
                  return (
                    <article key={c.id} className={cn("flex flex-col gap-1.5 rounded-2xl bg-white/[0.05] p-3 text-sm", postDated && "opacity-55")}>
                      <p className="flex items-start justify-between gap-2"><span className="font-mono">{c.chequeNo}</span><Money paise={c.amountPaise} size="md" /></p>
                      <p className="text-xs text-[var(--ds-on-surface-muted)]">{c.bank} · dated {day(c.chequeDate)}</p>
                      <p className="text-xs"><Ref href={`/app/fees/students/${studentId}`}>{studentName}</Ref> · <Ref href={`/app/fees/receipts/${c.receiptId}`}>receipt</Ref></p>
                      {postDated ? <p className="text-xs text-[var(--ds-color-warning-400)]">Held until {day(c.chequeDate)}. It cannot be deposited before its date.</p> : null}
                      {c.status === "deposited" ? <p className="text-xs text-[var(--ds-on-surface-muted)]">Deposited {c.depositedOn ? day(c.depositedOn) : ""}</p> : null}
                      {c.status === "cleared" ? <p className="text-xs text-[var(--ds-on-surface-muted)]">Cleared {c.clearedOn ? day(c.clearedOn) : ""}</p> : null}
                      {c.status === "bounced" ? <p className="text-xs text-[var(--ds-color-danger-400)]">Bounced {c.bouncedOn ? day(c.bouncedOn) : ""}: {c.bounceReason}</p> : null}
                      <div className="mt-1 flex flex-wrap gap-2">
                        {c.status === "received" && !postDated && !noBank ? <FormModal title={`Deposit cheque ${c.chequeNo}`} icon="money" action={depositCheque} hidden={{ id: c.id }} values={{ date: today }} submitLabel="Mark deposited" trigger={{ label: "Deposit", variant: "secondary", size: "sm", plus: false }}
                          fields={[{ name: "cashAccountId", label: "Deposited in", type: "select", required: true, options: config.banks.map((b) => ({ value: b.id, label: b.name })) }, { name: "date", label: "Date", type: "date", max: today }]} /> : null}
                        {c.status === "deposited" ? (
                          <FormModal title={`Cheque ${c.chequeNo} cleared`} description={`${rupees(c.amountPaise)} is in the bank.`} icon="check" action={clearCheque} hidden={{ id: c.id }} values={{ date: today }} submitLabel="Mark cleared" trigger={{ label: "Cleared", variant: "secondary", size: "sm", plus: false }}
                            fields={[{ name: "date", label: "Cleared on", type: "date", max: today }]} />
                        ) : null}
                        {c.status === "received" || c.status === "deposited" ? (
                          <FormModal title={`Cheque ${c.chequeNo} bounced`} icon="clock" action={bounceCheque} hidden={{ id: c.id }} values={{ date: today }} submitLabel="Mark bounced" trigger={{ label: "Bounced", variant: "ghost", size: "sm", plus: false }}
                            summary={`${config.bounceChargePaise ? `A bounce charge of ${rupees(config.bounceChargePaise)} is billed. ` : "No bounce charge is set. "}The bills this cheque paid open again.`}
                            fields={[{ name: "reason", label: "Why did it bounce?", type: "textarea", required: true, placeholder: "For example: insufficient funds" }, { name: "date", label: "Bounced on", type: "date", max: today }]} />
                        ) : null}
                        {c.status === "bounced" ? <Link href={`/app/fees/collect?student=${studentId}`} className={buttonVariants({ variant: "secondary", size: "sm", className: "rounded-full" })}>Collect again</Link> : null}
                      </div>
                    </article>
                  );
                }) : <p className="rounded-2xl bg-white/[0.035] p-4 text-xs text-[var(--ds-on-surface-muted)]">None {key === "bounced" ? "bounced. Good." : "here."}</p>}
                {t.count > col.rows.length ? <p className="text-xs text-[var(--ds-on-surface-muted)]">Showing the latest {col.rows.length} of {t.count}.</p> : null}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
