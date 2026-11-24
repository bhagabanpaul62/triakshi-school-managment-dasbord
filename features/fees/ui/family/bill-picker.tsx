"use client";

import { useRouter } from "next/navigation";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { shortDate } from "@smw/ui/format";

export interface PickBill { id: string; kid: string; label: string; dueDate: string; state: string; totalPaise: number; latePaise: number }

/** Tick the bills to pay. The choice lives in the address, so the server draws the QR for exactly this total. */
export function BillPicker({ bills, chosen, many }: { bills: PickBill[]; chosen: string[]; many: boolean }) {
  const router = useRouter();
  const set = (ids: string[]) => router.replace(ids.length ? `/app/fees/pay?bills=${ids.join(",")}` : "/app/fees/pay?bills=none", { scroll: false });
  return (
    <ul className="flex flex-col gap-2">
      {bills.map((b) => (
        <li key={b.id}>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl bg-white/[0.04] p-3 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[var(--ds-primary)]" checked={chosen.includes(b.id)} onChange={(e) => set(e.target.checked ? [...chosen, b.id] : chosen.filter((x) => x !== b.id))} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">{b.label}<StateBadge state={b.state} /></span>
              <span className="text-xs text-[var(--ds-on-surface-muted)]">{many ? `${b.kid} · ` : ""}due {shortDate(b.dueDate)}{b.latePaise ? <> · includes late fee <Money paise={b.latePaise} size="sm" /></> : null}</span>
            </span>
            <Money paise={b.totalPaise} size="md" />
          </label>
        </li>
      ))}
    </ul>
  );
}
