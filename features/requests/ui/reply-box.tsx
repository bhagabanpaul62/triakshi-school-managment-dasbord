"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Composer } from "@smw/ui/comm/Composer";
import { TabBar } from "@smw/ui/kit/TabBar";
import { MODE_WORDS, type ReplyMode } from "../constants";
import { pulseNow } from "@smw/feature-notifications/ui/live-pulse";
import { sendReply } from "./actions";

const TABS = (Object.keys(MODE_WORDS) as Exclude<ReplyMode, "reply">[]).map((id) => ({ id, label: MODE_WORDS[id].tab }));

/** The one box under a conversation. A family replies; staff pick Answer, Ask or Note, and the line under the box says who will see it. */
export function ReplyBox({ id, staff, disabled }: { id: string; staff: boolean; disabled?: { reason: string; action?: { label: string; href: string } } }) {
  const router = useRouter();
  const [mode, setMode] = useState<ReplyMode>(staff ? "answer" : "reply");
  const send = async (fd: FormData) => {
    const r = await sendReply(fd);
    if (r.ok) { router.refresh(); pulseNow(); }
    return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
  };
  const words = mode === "reply" ? null : MODE_WORDS[mode];
  return (
    <div className="mt-3 flex flex-col gap-2">
      {staff && !disabled ? <TabBar tabs={TABS} value={mode as Exclude<ReplyMode, "reply">} onChange={setMode} label="What are you writing" /> : null}
      <Composer send={send} hidden={{ id, mode }} maxLength={4000} disabled={disabled} notice={staff ? words?.who : undefined}
        placeholder={words?.placeholder ?? "Write your reply"}
        files={mode === "note" ? undefined : { accept: ["application/pdf", "image/*"], maxCount: 5, maxMb: 15 }} />
    </div>
  );
}
