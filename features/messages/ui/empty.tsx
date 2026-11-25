import Link from "next/link";
import { PILL_BTN } from "./styles";

/** What goes here, and the one button that makes the first one. "No match" and "first use" pass different words. */
export function UnreadFallback({ title, text, href, label }: { title: string; text: string; href?: string; label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-[var(--ds-on-surface)]">{title}</p>
      <p className="max-w-xs text-sm text-[var(--ds-on-surface-muted)]">{text}</p>
      {href && label ? <Link href={href} className={PILL_BTN}>{label}</Link> : null}
    </div>
  );
}
