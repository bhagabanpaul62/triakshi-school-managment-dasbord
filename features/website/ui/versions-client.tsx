"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { IconCheck } from "@tabler/icons-react";
import { EmptyLine } from "@smw/ui/finance/States";
import { Panel } from "@smw/ui/kit/Panel";
import { dateTime } from "@smw/ui/format";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Button } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { compareVersions, nameVersion, restoreVersion } from "./site-actions";

export interface VersionItem { number: number; kind: "publish" | "schedule" | "before_restore"; name: string; changes: string[]; byName: string; at: string; live: boolean }
const M = "text-[var(--ds-on-surface-muted)]";
const KIND = { publish: "Published", schedule: "Published on schedule", before_restore: "Draft saved before a restore" } as const;
const nameFields: Field[] = [{ name: "name", label: "Name", hint: "Like: Admissions open 2027. Leave empty to clear.", wide: true }];

export function VersionsClient({ rows, canManage }: { rows: VersionItem[]; canManage: boolean }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [diff, setDiff] = useState<{ from: number; to: number; lines: string[] } | null>(null);
  const [pending, start] = useTransition();
  const toggle = (n: number) => { setDiff(null); setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n].slice(-2))); };
  const compare = () => start(async () => {
    const fd = new FormData(); fd.set("a", String(picked[0])); fd.set("b", String(picked[1]));
    const r = await compareVersions(fd);
    if (r.ok) setDiff(r.data); else toast(r.error, "danger");
  });

  if (rows.length === 0) {
    return <EmptyLine title="Nothing has been published yet." hint="The first time you publish, a copy of the website is kept here with your note and a list of what it holds. Each later publish adds one, so a mistake can always be undone."
      action={<Link href="/app/website" className="inline-flex h-10 items-center rounded-full bg-[var(--ds-primary)] px-5 text-sm font-medium text-[var(--ds-on-primary)]">Go to publish</Link>} />;
  }
  return (
    <div className="pb-8">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className={cn("text-sm", M)}>Tick two versions to see what changed between them.</p>
        <Button type="button" variant="secondary" className="rounded-full" disabled={picked.length !== 2} isLoading={pending} onClick={compare}>Compare</Button>
      </div>
      {diff ? (
        <Panel title={`What changed from version ${diff.from} to ${diff.to}`} className="mb-3 h-auto">
          <ul className="list-disc pl-5 text-sm">{diff.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        </Panel>
      ) : null}
      <ul className="flex flex-col gap-2">
        {rows.map((v) => (
          <li key={v.number} className="rounded-3xl bg-[var(--ds-surface-container-low)] p-4">
            <div className="flex flex-wrap items-start gap-3">
              <label className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center"><span className="sr-only">Select version {v.number} to compare</span>
                <input type="checkbox" checked={picked.includes(v.number)} onChange={() => toggle(v.number)} className="h-4 w-4 accent-[var(--ds-primary)]" /></label>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Version {v.number}{v.name ? `: ${v.name}` : ""}</span>
                  {v.live ? <ToneBadge label="Live now" tone="success" /> : null}
                  {v.kind !== "publish" ? <ToneBadge label={KIND[v.kind]} tone="default" /> : null}
                </div>
                <p className={cn("text-xs", M)}>{dateTime(v.at)}{v.byName ? ` by ${v.byName}` : ""}</p>
                {v.changes.length ? <ul className={cn("mt-2 list-disc pl-5 text-xs", M)}>{v.changes.map((c) => <li key={c}>{c}</li>)}</ul> : <p className={cn("mt-2 text-xs", M)}>Nothing changed from the one before.</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a href={`/?preview=1&version=${v.number}`} target="_blank" rel="noopener" className="inline-flex h-9 items-center rounded-full bg-white/[0.07] px-4 text-sm hover:bg-white/[0.12]">Preview</a>
                {canManage ? <FormModal title={`Name version ${v.number}`} icon="web" fields={nameFields} action={nameVersion} hidden={{ number: String(v.number) }} values={{ name: v.name }} trigger={{ label: "Name", variant: "ghost", size: "sm" }} /> : null}
                {canManage ? (
                  <ActionButton variant="secondary" label="Bring back as draft" action={restoreVersion} values={{ number: String(v.number) }} successMessage="Brought back as your draft. Publish to make it live."
                    confirm={{ title: `Bring back version ${v.number}?`, body: "Your draft becomes this version. The draft as it is now is saved first as its own version, so nothing is lost. Visitors see no change until you publish. News and events are not part of a version and stay as they are.", confirmLabel: "Bring back" }}>
                    <IconCheck className="mr-1.5 h-4 w-4" aria-hidden />Bring back as draft
                  </ActionButton>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
