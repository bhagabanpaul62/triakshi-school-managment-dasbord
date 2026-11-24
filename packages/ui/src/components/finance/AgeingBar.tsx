import type { Tone } from "../../lib/tone";
import { SplitBar, type SplitPart } from "./SplitBar";

export interface AgeingBucket {
  /** "Not due", "1-30 days", "31-60 days"... oldest last. */
  label: string;
  paise: number;
  /** Link to the list behind this bucket. */
  href?: string;
}

export interface AgeingBarProps {
  /** Oldest last: the colour climbs from neutral through amber to red with age. */
  buckets: AgeingBucket[];
  label?: string;
}

const toneAt = (i: number, n: number): Tone | undefined => {
  if (i === 0) return undefined;
  const r = n > 1 ? i / (n - 1) : 0;
  return r < 0.67 ? "warning" : "danger";
};

/** Money owed split by how late it is, with each bucket's value and share in the legend. */
export function AgeingBar({ buckets, label = "Outstanding by age" }: AgeingBarProps) {
  const parts: SplitPart[] = buckets.map((b, i) => ({ ...b, tone: toneAt(i, buckets.length) }));
  return <SplitBar parts={parts} label={label} emptyText="Nothing outstanding." />;
}
