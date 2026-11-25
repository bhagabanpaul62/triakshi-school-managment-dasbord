import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { dateTime } from "@smw/ui/format";
import { SafeguardService } from "../safeguard";
import { UnreadFallback } from "./empty";
import { SafeguardNav } from "./safeguarding-page";

export const metadata = { title: "Review log" };

/** Every time somebody opened or exported a conversation they were not in. Nobody can edit or delete a line, not even an admin. */
export default async function ReviewLogPage() {
  const rows = await new SafeguardService(await requireCtx()).log();
  return (
    <>
      <PageHeader eyebrow="Safeguarding" title="Review log" description="Who opened a conversation they were not in, when and why. It cannot be edited." />
      <SafeguardNav here="/app/safeguarding/log" />
      {rows.length ? (
        <div className="overflow-x-auto rounded-3xl bg-[var(--ds-surface-container-low)] p-2">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Review log, newest first</caption>
            <thead className="text-xs text-[var(--ds-on-surface-muted)]"><tr><th className="px-3 py-2 font-normal">When</th><th className="px-3 py-2 font-normal">Who</th><th className="px-3 py-2 font-normal">Did</th><th className="px-3 py-2 font-normal">Conversation</th><th className="px-3 py-2 font-normal">Why</th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="align-top hover:bg-white/[0.03]">
                  <td className="whitespace-nowrap px-3 py-3 text-[var(--ds-on-surface-muted)]">{dateTime(v.at)}</td><td className="px-3 py-3">{v.reviewer}</td>
                  <td className="px-3 py-3">{v.action === "exported" ? "Exported" : "Opened"}</td>
                  <td className="px-3 py-3">{v.reportId ? <Link className="underline" href={`/app/safeguarding/${v.reportId}`}>{v.subject}</Link> : v.subject}</td>
                  <td className="px-3 py-3 text-[var(--ds-on-surface-variant)]">{v.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <UnreadFallback title="Nothing opened yet" text="When a safeguarding lead opens a conversation, the line shows here." />}
    </>
  );
}
