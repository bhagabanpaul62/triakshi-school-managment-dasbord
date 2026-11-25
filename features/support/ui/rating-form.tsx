"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconStar, IconStarFilled } from "@tabler/icons-react";
import { cn } from "@smw/ui/utils";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";

const WORDS = ["Poor", "Not good", "Fine", "Good", "Very good"];

/** Five stars and a line, once a ticket is solved. Can be changed. */
export function RatingForm({ ticketId, action, current }: { ticketId: string; action: (fd: FormData) => Promise<FormResult>; current: { rating: number | null; note: string | null } }) {
  const [rating, setRating] = useState(current.rating ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = (fd: FormData) => start(async () => {
    fd.set("id", ticketId); fd.set("rating", String(rating));
    if (!rating) { setError("Choose a star first"); return; }
    const r = await action(fd);
    if (r.ok) { setError(null); toast(r.message ?? "Thank you"); router.refresh(); } else setError(r.fieldErrors?.rating ?? r.error);
  });
  return (
    <form action={submit} className="flex flex-col gap-3" noValidate>
      <div role="radiogroup" aria-label="Your rating" className="flex items-center gap-1">
        {WORDS.map((w, i) => (
          <button key={w} type="button" role="radio" aria-checked={rating === i + 1} aria-label={`${i + 1} of 5, ${w}`} onClick={() => { setRating(i + 1); setError(null); }}
            className={cn("inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]", i < rating ? "text-[var(--ds-color-warning-400)]" : "text-[var(--ds-on-surface-muted)]")}>
            {i < rating ? <IconStarFilled className="h-6 w-6" aria-hidden /> : <IconStar className="h-6 w-6" aria-hidden />}
          </button>
        ))}
        <span className="ml-2 text-sm text-[var(--ds-on-surface-variant)]">{rating ? WORDS[rating - 1] : ""}</span>
      </div>
      <label htmlFor="rating-note" className="sr-only">One line about how we did (optional)</label>
      <input id="rating-note" name="note" defaultValue={current.note ?? ""} maxLength={500} placeholder="One line about how we did (optional)" className={INPUT} />
      {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
      <div className="flex justify-end"><Button type="submit" variant="secondary" className="h-10 rounded-full" isLoading={pending}>{current.rating ? "Change rating" : "Send rating"}</Button></div>
    </form>
  );
}
