import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import type { BandReport } from "../holidays";
import { TEXT } from "./tones";

/** Teaching days of the year for classes 1 to 5 and 6 to 8, against the least a school must teach. */
export function WorkingDaysPanel({ yearName, bands }: { yearName: string | null; bands: BandReport[] }) {
  return (
    <Panel title={yearName ? `Teaching days in ${yearName}` : "Teaching days"}>
      {bands.length === 0 ? <WidgetEmptyState title={yearName ? "No classes yet." : "No academic year yet."} description="Set up the year and classes, and the count shows here." /> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {bands.map((b) => (
            <div key={b.key} className="rounded-2xl bg-white/[0.04] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{b.label}</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className={`text-3xl font-light tabular-nums ${b.short ? TEXT.warning : TEXT.success}`}>{b.year}</span>
                <span className="text-sm text-[var(--ds-on-surface-muted)]">of at least {b.minimum} days</span>
              </p>
              {b.short ? <p className={`mt-2 text-sm ${TEXT.warning}`}>{b.minimum - b.year} days short. Remove a holiday or add a working Sunday.</p> : null}
              {b.terms.length ? <div className="mt-3 flex flex-wrap gap-2">{b.terms.map((t) => <ToneBadge key={t.name} label={`${t.name}: ${t.days}`} />)}</div> : null}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
