import type { DiffLine } from "./diff";

/** Removed lines in red and struck through, added in green. Used for history and for the approver's dialog. */
export function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="custom-scrollbar max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/20 p-3 font-sans text-xs leading-5">
      {lines.map((l, k) => <span key={k} className={`block ${l.kind === "added" ? "bg-[var(--ds-color-success-500)]/15 text-[var(--ds-color-success-400)]" : l.kind === "removed" ? "bg-[var(--ds-color-danger-500)]/15 text-[var(--ds-color-danger-400)] line-through" : "text-[var(--ds-on-surface-variant)]"}`}>{l.text || " "}</span>)}
    </pre>
  );
}
