"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@smw/ui/utils";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import type { RsvpAnswer } from "../constants";
import { answerEvent } from "./actions";

const CHOICES: { value: RsvpAnswer; label: string }[] = [{ value: "yes", label: "Yes, I will come" }, { value: "maybe", label: "Maybe" }, { value: "no", label: "No" }];
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";

export interface RsvpBarProps { eventId: string; answer: RsvpAnswer | null; waiting: boolean; guests: number; maxGuests: number; /** Why answering is not possible: closed, full is not a reason (the waiting list takes over). */ closedReason?: string }

function say(answer: RsvpAnswer | null, waiting: boolean, guests: number) {
  if (!answer) return "You have not answered yet.";
  if (answer === "no") return "You said you cannot come.";
  if (answer === "maybe") return "You said maybe.";
  if (waiting) return "The event is full. You are on the waiting list, and you will be told if a place opens.";
  return guests ? `You are coming, with ${guests} ${guests === 1 ? "guest" : "guests"}.` : "You are coming.";
}

/** The answer buttons come first for an invited person. The change shows at once and snaps back, with the reason, if it fails. */
export function RsvpBar({ eventId, answer, waiting, guests, maxGuests, closedReason }: RsvpBarProps) {
  const router = useRouter();
  const [shown, setShown] = useState({ answer, waiting, guests });
  const [pending, start] = useTransition();

  const send = (next: RsvpAnswer, g: number) => {
    const before = shown;
    setShown({ answer: next, waiting: next === "yes" ? before.waiting : false, guests: next === "no" ? 0 : g });
    start(async () => {
      const fd = new FormData();
      fd.set("id", eventId); fd.set("answer", next); fd.set("guests", String(next === "no" ? 0 : g));
      const r = await answerEvent(fd);
      if (!r.ok) { setShown(before); toast(r.error, "danger"); return; }
      setShown({ answer: next, waiting: r.data === "waiting", guests: next === "no" ? 0 : g });
      if (r.data === "waiting") toast("The event is full. You are on the waiting list.");
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="rsvp-h" className="flex flex-col gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] p-6">
      <h2 id="rsvp-h" className="text-[15px] font-medium text-[var(--ds-on-surface)]">Will you come?</h2>
      {closedReason ? <p className="text-sm text-[var(--ds-on-surface-variant)]">{closedReason}</p> : null}
      <div role="group" aria-label="Your answer" className="grid gap-2 sm:grid-cols-3">
        {CHOICES.map((c) => (
          <button key={c.value} type="button" aria-pressed={shown.answer === c.value} disabled={pending || !!closedReason} onClick={() => send(c.value, shown.guests)}
            className={cn("min-h-12 rounded-full px-4 text-sm font-medium transition-colors disabled:opacity-60", FOCUS, shown.answer === c.value ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.07] text-[var(--ds-on-surface)] hover:bg-white/[0.12]")}>
            {c.label}
          </button>
        ))}
      </div>
      {maxGuests > 0 && shown.answer && shown.answer !== "no" ? (
        <label className="flex items-center gap-3 text-sm text-[var(--ds-on-surface-variant)]">
          Guests with you
          <select value={shown.guests} disabled={pending || !!closedReason} onChange={(e) => send(shown.answer!, Number(e.target.value))} className={cn(INPUT, "w-24")}>
            {Array.from({ length: maxGuests + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      ) : null}
      <p role="status" className="text-sm text-[var(--ds-on-surface)]">{say(shown.answer, shown.waiting, shown.guests)}</p>
    </section>
  );
}
