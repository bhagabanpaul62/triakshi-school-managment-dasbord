import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";
import { TONE } from "../../../lib/tone";
import { cn } from "../../../lib/utils";

/** "▲ 12%" pill. Direction sets the arrow; tone (not direction) sets the colour, since "down" is sometimes good. */
export function DeltaChip({
  children,
  direction,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  direction?: "up" | "down" | "flat";
  tone?: "default" | "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        TONE[tone].chip,
        className,
      )}
    >
      {direction === "up" && <IconTrendingUp className="h-3 w-3" aria-hidden />}
      {direction === "down" && <IconTrendingDown className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  );
}
