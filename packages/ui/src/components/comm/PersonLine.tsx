import { cn } from "../../lib/utils";

export interface PersonLineProps {
  name: string;
  /** Second line: class and section, role, "Parent of Riya". */
  sub?: string;
  size?: "sm" | "md";
  className?: string;
}

/** First letters of the first two words, safe for Hindi and other scripts. */
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] ?? "").join("").toUpperCase() || "?";

/** Avatar with initials, name and a quiet second line. */
export function PersonLine({ name, sub, size = "md", className }: PersonLineProps) {
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-full bg-white/[0.08] font-medium text-[var(--ds-on-surface-variant)]", size === "sm" ? "h-7 w-7 text-[10px]" : "h-10 w-10 text-xs")}>{initials(name)}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-[var(--ds-on-surface)]">{name}</span>
        {sub ? <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{sub}</span> : null}
      </span>
    </span>
  );
}
