import Link from "next/link";
import { allows, type Ctx } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import financeFeature from "@smw/feature-finance/feature";
import { BigStat, StatGroup } from "@smw/ui/kit/BigStat";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { buttonVariants } from "@smw/ui/ui/button";
import { formatPaise } from "@smw/ui/finance/logic";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { depositToBank } from "../collect-actions";
import { askDifferenceAgain, reopenCounter, withdrawDifference } from "./counter-actions";
import { CounterService, DeskService } from "../../service";
import { CloseCounter } from "./counter-forms";
import { OpenCounter } from "./open-counter";
import { todayIST } from "@smw/feature-kit/money";
import { DeskNav, H2, NoAccess, Notice, MoneySetup, SECTION, can, day, one, type Search } from "./shared";

export const metadata = { title: "Cash counter" };

const STATE: Record<string, string> = { pending: "Waiting for approval", recount: "Not decided", posted: "Written to cash differences", cashier: "Kept with the cashier" };
const ASKS = "/app/finance/approvals?status=all&kind=fees.counter_difference";

type Closed = Awaited<ReturnType<CounterService["history"]>>[number];

/** Where a counter difference stands and the one thing to do next, for the person it concerns. */
function Difference({ h, mine, admin, approver }: { h: Closed; mine: boolean; admin: boolean; approver: boolean }) {
  if (!h.differenceState) return null;
  const ask = approver ? <Link href={ASKS} className="underline underline-offset-4">Open the request</Link> : <span className="text-[var(--ds-on-surface-muted)]">An approver decides</span>;
  const own = mine || admin;
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <span>{STATE[h.differenceState]}</span>
      {h.differenceState === "pending" ? <>{ask}{own ? <ActionButton label="Withdraw" variant="ghost" action={withdrawDifference} values={{ id: h.id }} confirm={{ title: "Take this request back?", body: "The difference stays unbooked until you ask again or count again.", confirmLabel: "Withdraw" }} /> : null}</> : null}
      {h.differenceState === "recount" ? <>
        <span className="text-[var(--ds-on-surface-muted)]">Count again, or ask again.</span>
        {own ? <ActionButton label="Ask again" variant="secondary" action={askDifferenceAgain} values={{ id: h.id }} /> : null}
        {mine && h.day === todayIST() ? <ActionButton label="Count again" variant="ghost" action={reopenCounter} values={{ id: h.id }} confirm={{ title: "Reopen this counter?", body: "It opens again for today so you can count and close it.", confirmLabel: "Reopen" }} /> : null}
      </> : null}
      {h.differenceState === "cashier" ? <span className="text-[var(--ds-on-surface-muted)]">The cashier owes it until it is settled.</span> : null}
    </span>
  );
}

export default async function CounterPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "collect")) return <NoAccess what="The cash counter" who="cashiers, accountants and admins" />;
  const sp = await searchParams;
  const counters = new CounterService(ctx);
  const [cur, history, config] = await Promise.all([counters.current(), counters.history(), new DeskService(ctx).config()]);
  const closedToday = history.some((h) => h.userId === ctx.userId && h.day === config.today && h.closedAt);
  const justClosed = history.find((h) => h.id === one(sp.closed));
  const canMove = allows(ctx, financeFeature, "journal"), approver = allows(ctx, financeFeature, "approve"), admin = ctx.role === "admin";

  return (
    <>
      <PageHeader eyebrow="Fees" title="Cash counter" description="Open with a float, take money all day, count it at the end, hand it over or bank it."
        actions={cur ? <CloseCounter counterId={cur.counter.id} expectedPaise={cur.expectedPaise} primary /> : null} />
      <DeskNav ctx={ctx} current="/app/fees/counter" />

      {justClosed ? (
        <section className={`${SECTION} mb-6`} aria-label="Counter closed">
          <h2 className={H2}>Counter closed for {day(justClosed.day)}</h2>
          <StatGroup columns={3}>
            <BigStat label="Should be in the box" value={formatPaise(justClosed.expectedPaise ?? 0)} />
            <BigStat label="Counted" value={formatPaise(justClosed.countedPaise ?? 0)} />
            <BigStat label="Difference" value={formatPaise(justClosed.differencePaise ?? 0, { sign: "always" })} tone={justClosed.differencePaise ? "danger" : "success"} hint={justClosed.differenceReason ?? "The box matches."} />
          </StatGroup>
          {justClosed.differenceState ? <div className="mt-3"><Difference h={justClosed} mine={justClosed.userId === ctx.userId} admin={admin} approver={approver} /></div> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/app/fees/counter/${justClosed.id}/slip`} target="_blank" className={buttonVariants({ className: "rounded-full" })}>Print handover slip</Link>
            <DepositForm id={justClosed.id} from={justClosed.cashAccountId} amount={Math.max(0, (justClosed.countedPaise ?? 0) - justClosed.floatPaise)} banks={config.banks} canMove={canMove} ctx={ctx} />
          </div>
        </section>
      ) : null}

      {cur ? (
        <section className={SECTION} aria-label="Today at the counter">
          <h2 className={H2}>Open since {day(cur.counter.day)}</h2>
          <StatGroup columns={4}>
            <BigStat label="Float at opening" value={formatPaise(cur.counter.floatPaise)} />
            <BigStat label="Cash taken" value={formatPaise(cur.takenPaise)} hint={`${cur.receipts} receipt${cur.receipts === 1 ? "" : "s"}`} />
            <BigStat label="Cash refunded" value={formatPaise(cur.refundedPaise)} />
            <BigStat label="Should be in the box" value={formatPaise(cur.expectedPaise)} size="lg" />
          </StatGroup>
          <p className="mt-4 text-sm text-[var(--ds-on-surface-muted)]">When you close, you count the notes and coins. A difference needs a reason; the day then takes no more money. A difference above the school's limit waits for an approver before it is written off.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/fees/collect" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Back to collecting</Link>
            <Link href="/app/fees/receipts" className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Today's receipts</Link>
          </div>
        </section>
      ) : (
        <>
          {!justClosed ? (
            <Notice tone="info" action={closedToday ? undefined : <OpenCounter />}>
              {closedToday ? "Your counter for today is closed, and a closed day takes no more money. Open a new one tomorrow, or ask an admin." : "Your counter is closed. Open it with the cash already in the box to take cash today."}
            </Notice>
          ) : null}
          {!config.usesCounters ? <EmptyLine title="Nobody has opened a counter yet." hint="Until the first one is opened, cash can be taken without it. Once it is, cash needs an open counter." /> : null}
        </>
      )}

      <section className={`${SECTION} mt-6`} aria-label="Counter history">
        <h2 className={H2}>History</h2>
        {history.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="text-left text-xs text-[var(--ds-on-surface-muted)]"><th className="py-2 pr-3 font-normal">Day</th><th className="pr-3 font-normal">Cashier</th><th className="pr-3 text-right font-normal">Float</th><th className="pr-3 text-right font-normal">Should be</th><th className="pr-3 text-right font-normal">Counted</th><th className="pr-3 text-right font-normal">Difference</th><th className="pr-3 font-normal">Why</th><th className="font-normal">Decision</th><th /></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-white/[0.06]">
                    <td className="py-2 pr-3 whitespace-nowrap">{day(h.day)}</td><td className="pr-3">{h.cashier}</td>
                    <td className="pr-3 text-right"><Money paise={h.floatPaise} size="sm" /></td><td className="pr-3 text-right"><Money paise={h.expectedPaise} size="sm" /></td><td className="pr-3 text-right"><Money paise={h.countedPaise} size="sm" /></td>
                    <td className="pr-3 text-right">{h.closedAt ? <Money paise={h.differencePaise} size="sm" sign="always" tone={h.differencePaise ? "danger" : "success"} /> : <span className="text-[var(--ds-on-surface-muted)]">Open</span>}</td>
                    <td className="max-w-[24ch] truncate text-[var(--ds-on-surface-muted)]" title={h.differenceReason ?? ""}>{h.differenceReason ?? "-"}</td>
                    <td className="py-2 pr-3">{h.differenceState ? <Difference h={h} mine={h.userId === ctx.userId} admin={admin} approver={approver} /> : <span className="text-[var(--ds-on-surface-muted)]">-</span>}</td>
                    <td className="text-right">{h.closedAt ? <Link href={`/app/fees/counter/${h.id}/slip`} target="_blank" className="underline underline-offset-4">Slip</Link> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyLine title="No counter days yet." hint="Open your counter to start the first one." />}
      </section>
      {!canMove && justClosed ? <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Only an accountant or admin can record the bank deposit.</p> : null}
      {!cur && !justClosed && config.banks.length === 0 ? <Notice tone="warning" action={<MoneySetup ctx={ctx} next="/app/fees/counter">Add a bank account</MoneySetup>}>There is no bank account yet, so cash cannot be deposited.</Notice> : null}
    </>
  );
}

/** Cash counted less the float, moved from the cash box to a bank account. Only people who may post it see the button. */
function DepositForm({ id, from, amount, banks, canMove, ctx }: { id: string; from: string; amount: number; banks: { id: string; name: string }[]; canMove: boolean; ctx: Ctx }) {
  if (!canMove) return null;
  if (!banks.length) return <MoneySetup ctx={ctx} next="/app/fees/counter">Add a bank account first</MoneySetup>;
  return (
    <FormModal title="Deposit to bank" description="Moves cash from the cash box to the bank in the ledger. Do this when the money reaches the bank." icon="money" action={depositToBank} submitLabel="Record deposit"
      trigger={{ label: "Deposit to bank", variant: "secondary", plus: false }} hidden={{ fromId: from, memo: `Counter deposit ${id.slice(0, 8)}` }} values={{ amountPaise: amount }}
      fields={[{ name: "toId", label: "Deposited in", type: "select", required: true, options: banks.map((b) => ({ value: b.id, label: b.name })) }, { name: "amountPaise", label: "Amount deposited", type: "money", required: true, hint: "Counted cash less the float you keep for tomorrow." }, { name: "date", label: "Date", type: "date" }]} />
  );
}
