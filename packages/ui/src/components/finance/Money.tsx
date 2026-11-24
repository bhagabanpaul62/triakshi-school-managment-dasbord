import { cn } from "../../lib/utils";
import { TONE, type Tone } from "../../lib/tone";
import { formatPaise } from "./logic";

const SIZE = { sm: "text-xs", md: "text-sm", lg: "text-xl font-medium", xl: "text-[26px] font-medium leading-none" } as const;

export interface MoneyProps {
  /** Integer paise. null or undefined shows a muted dash. */
  paise: number | bigint | null | undefined;
  /** Colour only when it carries meaning: danger for what is owed late, success for what is settled. */
  tone?: Tone;
  /** "auto" shows a minus when negative; "always" also shows a plus; "abs" hides the sign. */
  sign?: "auto" | "always" | "abs";
  size?: keyof typeof SIZE;
  /** Always two decimals (ledgers, documents). */
  fixed?: boolean;
  className?: string;
}

/** An amount of money: tabular, right aligned inside its cell, never wrapped. */
export function Money({ paise, tone = "default", sign = "auto", size = "md", fixed, className }: MoneyProps) {
  if (paise == null) return <span className={cn("text-[var(--ds-on-surface-muted)]", SIZE[size], className)}>-</span>;
  return <span className={cn("inline-block whitespace-nowrap text-right tabular-nums", SIZE[size], TONE[tone].text, className)}>{formatPaise(Number(paise), { fixed, sign })}</span>;
}
