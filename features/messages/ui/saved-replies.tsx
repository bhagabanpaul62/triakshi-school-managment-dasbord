"use client";

import { useId } from "react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { cn } from "@smw/ui/utils";

export interface ReplyOption { id: string; title: string; body: string; shared: boolean }

/** Drops a saved reply into the message box above it; the writer can still change it before sending. */
export function SavedReplyPicker({ replies }: { replies: ReplyOption[] }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">Insert a saved reply</label>
      <select id={id} defaultValue="" className={cn(INPUT, "h-9 text-xs")}
        onChange={(e) => {
          const reply = replies.find((r) => r.id === e.target.value);
          const box = e.target.closest("form")?.querySelector<HTMLTextAreaElement>("textarea[name=text]");
          if (reply && box) {
            // React tracks the value itself: set it through the native setter, then tell React.
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, reply.body);
            box.dispatchEvent(new Event("input", { bubbles: true }));
            box.focus();
          }
          e.target.value = "";
        }}>
        <option value="">Insert a saved reply</option>
        {replies.map((r) => <option key={r.id} value={r.id}>{r.title}{r.shared ? " (office)" : ""}</option>)}
      </select>
    </div>
  );
}
