import type { BalanceRow } from "../leave-balances";
import { fmtDays } from "../leave-days";

/** One compact bar per leave type: used, waiting and left, in days. Unpaid types have no limit, so they show days taken. */
export function LeaveBars({ rows }: { rows: BalanceRow[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Leave balances">
      {rows.map((b) => {
        const total = Math.max(b.entitled, 1);
        const pct = (n: number) => `${Math.min(100, Math.max(0, (n / total) * 100))}%`;
        return (
          <li key={b.typeId} className="rounded-3xl bg-white/[0.04] p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm text-[var(--ds-on-surface)]">{b.name}</p>
              <p className="text-2xl font-light tabular-nums text-[var(--ds-on-surface)]">{b.paid ? fmtDays(b.left - b.pending) : fmtDays(b.used)}</p>
            </div>
            {b.paid ? (
              <>
                <div role="img" aria-label={`${fmtDays(b.used)} used, ${fmtDays(b.pending)} waiting, ${fmtDays(b.left - b.pending)} left of ${fmtDays(b.entitled)}`} className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <span style={{ width: pct(b.used) }} className="bg-[var(--ds-on-surface-muted)]" />
                  <span style={{ width: pct(b.pending) }} className="bg-[var(--ds-color-warning-500)]" />
                </div>
                <p className="mt-2 text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{fmtDays(b.used)} used · {fmtDays(b.pending)} waiting · of {fmtDays(b.entitled)}</p>
              </>
            ) : <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">days taken this year, cut from salary{b.pending ? ` · ${fmtDays(b.pending)} waiting` : ""}</p>}
          </li>
        );
      })}
    </ul>
  );
}
