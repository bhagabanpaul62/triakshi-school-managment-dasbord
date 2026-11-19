export type ProrationQuote =
  | { kind: "upgrade"; amountPaise: number; remainingDays: number; periodDays: number }
  | { kind: "downgrade"; scheduleAt: Date }
  | { kind: "same" };

const DAY = 86_400_000;

/** Mid-period plan change (prices are for the current interval): upgrades charge the price difference for the days left; downgrades wait for renewal. Pure. */
export class ProrationCalculator {
  static quote(p: { oldPaise: number; newPaise: number; periodStart: Date; periodEnd: Date; now: Date }): ProrationQuote {
    if (p.newPaise === p.oldPaise) return { kind: "same" };
    if (p.newPaise < p.oldPaise) return { kind: "downgrade", scheduleAt: p.periodEnd };
    const periodDays = Math.max(1, Math.round((p.periodEnd.getTime() - p.periodStart.getTime()) / DAY));
    const remainingDays = Math.min(periodDays, Math.max(0, Math.ceil((p.periodEnd.getTime() - p.now.getTime()) / DAY)));
    const amountPaise = Math.floor(((p.newPaise - p.oldPaise) * remainingDays) / periodDays);
    return { kind: "upgrade", amountPaise, remainingDays, periodDays };
  }
}
