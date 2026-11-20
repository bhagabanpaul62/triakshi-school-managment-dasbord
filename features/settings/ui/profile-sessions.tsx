"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import { dateTime } from "@smw/ui/format";
import { signOutDevice, signOutOtherDevices } from "./profile-actions";

export interface SessionRow { id: string; device: string; ip: string | null; lastSeenAt: Date; createdAt: Date; current: boolean }

/** Devices signed in to this account, each with its own sign-out. */
export function ProfileSessions({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, fn: () => ReturnType<typeof signOutOtherDevices>) => start(async () => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (r.ok) { toast(r.message ?? "Done"); router.refresh(); } else toast(r.error, "danger");
  });
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-[var(--ds-on-surface)]">
                {s.device}
                {s.current ? <span className="ml-2 rounded-full bg-[var(--ds-color-primary-500)]/20 px-2 py-0.5 text-[11px] text-[var(--ds-on-surface)]">This device</span> : null}
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--ds-on-surface-muted)]">{s.ip ?? "Unknown IP"} · signed in {dateTime(s.createdAt)} · last active {dateTime(s.lastSeenAt)}</p>
            </div>
            {s.current ? null : (
              <Button type="button" variant="secondary" size="sm" className="rounded-full" aria-label={`Sign out ${s.device}`} isLoading={pending && busy === s.id} disabled={pending}
                onClick={() => run(s.id, () => { const fd = new FormData(); fd.set("id", s.id); return signOutDevice(fd); })}>Sign out</Button>
            )}
          </li>
        ))}
      </ul>
      {others > 0 ? (
        <div>
          <Button type="button" variant="secondary" className="rounded-full" isLoading={pending && busy === "all"} disabled={pending} onClick={() => run("all", signOutOtherDevices)}>Sign out everywhere else</Button>
        </div>
      ) : <p className="text-xs text-[var(--ds-on-surface-muted)]">No other devices are signed in.</p>}
    </div>
  );
}
