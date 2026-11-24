"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import type { FormResult } from "@smw/ui/shell/FormModal";

/** Shows one sealed detail for ten seconds, then hides it again. Every look is logged on the server. */
export function RevealButton({ action, userId, field, masked }: { action: (fd: FormData) => Promise<FormResult>; userId: string; field: string; masked: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { if (!value) return; const t = setTimeout(() => setValue(null), 10_000); return () => clearTimeout(t); }, [value]);
  const show = () => start(async () => {
    const fd = new FormData(); fd.set("userId", userId); fd.set("field", field);
    const r = await action(fd);
    if (r.ok) setValue((r.data as { value: string }).value); else toast(r.error, "danger");
  });
  return (
    <span className="inline-flex items-center gap-3">
      <span className="font-mono text-sm tabular-nums" aria-live="polite">{value ?? masked}</span>
      {value ? <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => setValue(null)}>Hide</Button> : <Button type="button" variant="ghost" size="sm" className="rounded-full" isLoading={pending} onClick={show}>Show</Button>}
    </span>
  );
}
