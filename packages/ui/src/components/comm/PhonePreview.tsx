import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface PhonePreviewProps {
  /** The card exactly as the family feed would show it. */
  children: ReactNode;
  /** Small caption above the frame: "How families will see it". */
  caption?: string;
  className?: string;
}

/** A phone-width frame for previews while writing. Shrinks to fit narrow screens. */
export function PhonePreview({ children, caption = "How families will see it", className }: PhonePreviewProps) {
  return (
    <figure className={cn("mx-auto flex w-full max-w-[22rem] flex-col gap-2", className)}>
      <figcaption className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{caption}</figcaption>
      <div className="rounded-[2.25rem] bg-white/[0.06] p-2.5">
        <div className="flex min-h-[18rem] flex-col gap-3 rounded-[1.75rem] bg-[var(--ds-surface)] p-3 pt-4">
          <span aria-hidden className="mx-auto h-1.5 w-16 rounded-full bg-white/[0.1]" />
          {children}
        </div>
      </div>
    </figure>
  );
}
