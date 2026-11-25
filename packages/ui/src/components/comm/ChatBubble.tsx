import { cn } from "../../lib/utils";
import { FileList, type FileItem } from "./FileList";

export interface ChatBubbleProps {
  /** "message" is a normal bubble, "note" an internal note staff see and families never do, "system" a centred line such as "Riya joined". */
  kind?: "message" | "note" | "system";
  mine?: boolean;
  sender?: string;
  /** ISO time. */
  at: string;
  text?: string;
  files?: FileItem[];
  /** "Seen 10:42" under the newest message of mine. */
  seenLine?: string;
  /** Replaces the text with "This message was removed". `removedBy` says who, when it is not the sender. */
  removed?: boolean;
  removedBy?: string;
  /** Sending: not saved yet. Failed: shows Not sent. */
  status?: "sending" | "failed";
}

const clock = (at: string) => new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** One message. Mine on the right, theirs on the left; links in the text stay plain text (messages are not markdown). */
export function ChatBubble({ kind = "message", mine, sender, at, text, files = [], seenLine, removed, removedBy, status }: ChatBubbleProps) {
  if (kind === "system") return <p className="py-1 text-center text-xs text-[var(--ds-on-surface-muted)]">{text}</p>;
  const note = kind === "note";
  return (
    <div className={cn("flex flex-col gap-1", mine && !note ? "items-end" : "items-start")}>
      {note ? <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-color-warning-400)]">Internal note, families cannot see this</p> : null}
      {sender && !mine ? <p className="px-1 text-xs text-[var(--ds-on-surface-muted)]">{sender}</p> : null}
      <div className={cn("max-w-[85%] min-w-0 break-words rounded-2xl px-3.5 py-2.5 text-sm", note ? "bg-[var(--ds-color-warning-500)]/12 text-[var(--ds-on-surface)]" : mine ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.07] text-[var(--ds-on-surface)]", status === "sending" && "opacity-60")}>
        {removed ? <p className="italic opacity-70">{removedBy ? `Removed by ${removedBy}` : "This message was removed"}</p> : (
          <>
            {text ? <p className="whitespace-pre-wrap">{text}</p> : null}
            {files.length ? <FileList files={files} className={text ? "mt-2" : undefined} /> : null}
          </>
        )}
      </div>
      <p className="px-1 text-[11px] tabular-nums text-[var(--ds-on-surface-muted)]">
        {status === "failed" ? <span className="text-[var(--ds-color-danger-400)]">Not sent. </span> : null}
        {status === "sending" ? "Sending…" : clock(at)}
        {seenLine ? ` · ${seenLine}` : ""}
      </p>
    </div>
  );
}
