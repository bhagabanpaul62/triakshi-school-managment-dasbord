"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import type { CommStep } from "@smw/feature-setup/communication";

const HIDDEN = "smw-first-day-hidden";

/**
 * One compact card: "2 of 4 done" and the next step as the button. It goes away when every step is done (the server stops sending it)
 * or when the admin hides it; hiding is remembered in this browser, which is per school because every school has its own address.
 */
export function FirstDayCard({ steps }: { steps: Pick<CommStep, "key" | "label" | "text" | "href" | "done">[] }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { try { setHidden(localStorage.getItem(HIDDEN) === "1"); } catch { /* private window: the card stays */ } }, []);
  const next = steps.find((s) => !s.done);
  if (!next || hidden) return null;
  const done = steps.filter((s) => s.done).length;
  const hide = () => { setHidden(true); try { localStorage.setItem(HIDDEN, "1"); } catch { /* not remembered */ } };
  return (
    <Panel title="First days with families" action={<button type="button" onClick={hide} className="min-h-10 px-2 text-xs text-[var(--ds-on-surface-muted)] underline-offset-4 hover:underline">Hide</button>}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 basis-56 text-sm text-[var(--ds-on-surface-variant)]"><span className="font-medium text-[var(--ds-on-surface)]">{done} of {steps.length} done.</span> {next.text}</p>
        <Button asChild className="rounded-full"><Link href={next.href}>{next.label}</Link></Button>
      </div>
    </Panel>
  );
}
