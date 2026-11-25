import { IconPaperclip } from "@tabler/icons-react";
import { Markdown } from "@smw/ui/comm/Markdown";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { dateTime } from "@smw/ui/format";
import type { Tone } from "@smw/ui/tone";
import { RESPONSE_WORDS } from "../content";
import type { NoticeType, ResponseSpec } from "../constants";
import { TYPE_LABEL } from "./shared";

const fileSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);

export interface NoticeCardProps {
  type: NoticeType;
  number?: string | null;
  category?: { name: string; tone: string } | null;
  title: string;
  body: string;
  files?: { name: string; size: number }[];
  response?: ResponseSpec;
  dueAt?: Date | string | null;
  /** "Updated 25 Nov, 4:10 pm" */
  updatedAt?: Date | string | null;
}

/** A notice the way a family reads it. The same card is the phone preview while writing and the body of the family page. */
export function NoticeCard({ type, number, category, title, body, files = [], response, dueAt, updatedAt }: NoticeCardProps) {
  const asks = response && response.kind !== "none";
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-center gap-2">
        {type !== "notice" ? <ToneBadge label={TYPE_LABEL[type]} tone={type === "urgent" ? "danger" : "info"} /> : null}
        {category ? <ToneBadge label={category.name} tone={category.tone as Tone} /> : null}
        {number ? <span className="font-mono text-xs text-[var(--ds-on-surface-muted)]">{number}</span> : null}
      </div>
      <h2 className="break-words text-lg font-medium leading-snug text-[var(--ds-on-surface)]">{title || <span className="text-[var(--ds-on-surface-muted)]">Your title shows here</span>}</h2>
      {updatedAt ? <p className="text-xs text-[var(--ds-on-surface-muted)]">Updated {dateTime(updatedAt)}</p> : null}
      {body.trim() ? <Markdown source={body} /> : <p className="text-sm text-[var(--ds-on-surface-muted)]">What you write shows here.</p>}
      {files.length ? (
        <ul className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-variant)]">
          {files.map((f) => <li key={f.name} className="flex items-center gap-2"><IconPaperclip className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="min-w-0 truncate">{f.name}</span><span className="shrink-0 tabular-nums text-[var(--ds-on-surface-muted)]">{fileSize(f.size)}</span></li>)}
        </ul>
      ) : null}
      {asks ? (
        <p className="rounded-xl bg-white/[0.06] px-3 py-2 text-sm text-[var(--ds-on-surface)]">
          {type === "urgent" ? "Press I am safe, or Received" : RESPONSE_WORDS[response.kind]}{dueAt ? `, by ${dateTime(dueAt)}` : ""}
        </p>
      ) : null}
    </article>
  );
}
