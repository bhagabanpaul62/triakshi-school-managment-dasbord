import { parseMarkdown, type Inline } from "../../lib/markdown";
import { cn } from "../../lib/utils";

const LINK = "break-words text-[var(--ds-color-primary-300)] underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)] rounded-sm";

function Inl({ nodes }: { nodes: Inline[] }) {
  return nodes.map((n, i) => {
    if (n.t === "text") return n.v;
    if (n.t === "b") return <strong key={i} className="font-semibold text-[var(--ds-on-surface)]"><Inl nodes={n.c} /></strong>;
    if (n.t === "i") return <em key={i}><Inl nodes={n.c} /></em>;
    const external = /^https?:/i.test(n.href);
    return <a key={i} href={n.href} rel="noopener noreferrer" {...(external ? { target: "_blank" } : {})} className={LINK}><Inl nodes={n.c} /></a>;
  });
}

export interface MarkdownProps {
  /** The stored text. Only the safe subset is shown; anything else is plain text. */
  source: string;
  className?: string;
}

/** Renders the safe markdown subset from its AST. No HTML is ever injected. */
export function Markdown({ source, className }: MarkdownProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 break-words text-sm leading-6 text-[var(--ds-on-surface-variant)]", className)}>
      {parseMarkdown(source).map((b, i) => {
        if (b.t === "p") return <p key={i} className="whitespace-pre-line"><Inl nodes={b.c} /></p>;
        if (b.t === "h") {
          const cls = b.level === 1 ? "text-lg" : b.level === 2 ? "text-base" : "text-sm";
          return <p key={i} role="heading" aria-level={b.level + 1} className={cn("font-semibold text-[var(--ds-on-surface)]", cls)}><Inl nodes={b.c} /></p>;
        }
        const L = b.t;
        return <L key={i} className={cn("flex flex-col gap-1 pl-5", L === "ul" ? "list-disc" : "list-decimal")}>{b.items.map((it, j) => <li key={j}><Inl nodes={it} /></li>)}</L>;
      })}
    </div>
  );
}
