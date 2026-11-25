"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Composer } from "@smw/ui/comm/Composer";
import { cn } from "@smw/ui/utils";
import { sendReply } from "./actions";

type Mode = "reply" | "answer" | "ask" | "note";
const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "answer", label: "Answer the family", hint: "The family sees this as the school office." },
  { key: "ask", label: "Ask the family", hint: "The family is asked to reply, and the school's clock waits for them." },
  { key: "note", label: "Note for staff", hint: "Only staff see a note. Families never do." },
];

/** The one box under a conversation. A family replies; staff pick answer, ask or note. */
export function ReplyBox({ id, staff, disabled }: { id: string; staff: boolean; disabled?: { reason: string; action?: { label: string; href: string } } }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(staff ? "answer" : "reply");
  const send = async (fd: FormData) => {
    const r = await sendReply(fd);
    if (r.ok) router.refresh();
    return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
  };
  const hint = MODES.find((m) => m.key === mode)?.hint;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {staff && !disabled ? (
        <div role="radiogroup" aria-label="What are you writing" className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} onClick={() => setMode(m.key)}
              className={cn("h-9 rounded-full px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]", mode === m.key ? "bg-[var(--ds-on-surface)] font-medium text-[var(--ds-surface)]" : "bg-white/[0.06] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1]")}>{m.label}</button>
          ))}
        </div>
      ) : null}
      <Composer send={send} hidden={{ id, mode }} maxLength={4000} disabled={disabled} notice={hint}
        placeholder={mode === "note" ? "Write a note for staff" : mode === "ask" ? "Ask the family a question" : staff ? "Write the answer" : "Write your reply"}
        files={mode === "note" ? undefined : { accept: ["application/pdf", "image/*"], maxCount: 5, maxMb: 15 }} />
    </div>
  );
}
