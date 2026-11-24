import { cn } from "../../lib/utils";
import { TONE, type Tone } from "../../lib/tone";
import { sparkPath } from "./logic";

export interface SparklineProps {
  /** Values in time order, oldest first. */
  points: number[];
  tone?: Tone;
  /** Says what the line shows ("Collection, last 12 weeks"). Leave out when the number beside it already says it. */
  label?: string;
  width?: number;
  height?: number;
  className?: string;
}

/** A tiny trend line with no axes. Colour is set by tone; the last point is dotted. */
export function Sparkline({ points, tone = "default", label, width = 96, height = 28, className }: SparklineProps) {
  const { d, last } = sparkPath(points, width, height);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("max-w-full shrink-0 overflow-visible", TONE[tone].text, className)}>
      {d ? <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /> : <line x1={2} x2={width - 2} y1={height / 2} y2={height / 2} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />}
      {last ? <circle cx={last[0]} cy={last[1]} r={2.5} fill="currentColor" /> : null}
    </svg>
  );
}
