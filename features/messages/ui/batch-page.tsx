import Link from "next/link";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { shortDate, relative } from "@smw/ui/format";
import { BatchService, type BatchView } from "../batch";
import { UnreadFallback } from "./empty";
import { PILL_BTN } from "./styles";

export const metadata = { title: "Sent to families" };

/** "32 seen, 9 replied" for one send, then every family with where it stands. */
export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const svc = new BatchService(await requireCtx());
  let b: BatchView;
  try { b = await svc.get((await params).id); } catch (e) { if (e instanceof NotFoundError) return <UnreadFallback title="That message was not found" text="It may belong to someone else." href="/app/messages/families/sent" label="Sent to families" />; throw e; }
  const waiting = b.rows.filter((r) => !r.seen).length;
  return (
    <>
      <PageHeader eyebrow="Message families" title={b.subject} description={`${b.audienceLabel}. Sent ${shortDate(b.createdAt)}${b.byName ? ` by ${b.byName}` : ""}.`}
        actions={<Link href="/app/messages/families" className={PILL_BTN}>Message more families</Link>} />
      <Panel title={`${b.seen} seen, ${b.replied} replied, of ${b.total}`}>
        <div role="img" aria-label={`${b.replied} replied, ${Math.max(0, b.seen - b.replied)} seen without a reply, ${waiting} not seen`} className="flex h-3 overflow-hidden rounded-full bg-white/[0.08]">
          {[[b.replied, "bg-[var(--ds-color-success-400)]"], [Math.max(0, b.seen - b.replied), "bg-white/55"]].map(([n, c], i) => <span key={i} className={String(c)} style={{ width: `${b.total ? (Number(n) / b.total) * 100 : 0}%` }} />)}
        </div>
        <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">{waiting ? `${waiting} ${waiting === 1 ? "family has" : "families have"} not opened it yet.` : "Every family has opened it."} Seen marks wait while a family is in quiet hours.</p>
      </Panel>
      {/* On a phone each family is a card: a 28 rem table would push the page 48 px past a 375 px screen. */}
      <ul className="mt-3 flex flex-col gap-2 sm:hidden" aria-label="Families and where each conversation stands">
        {b.rows.map((r) => (
          <li key={r.threadId} className="rounded-2xl bg-white/[0.04] p-3">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0"><span className="block truncate text-sm">{r.student}</span><span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{r.label}</span></span>
              <Link href={`/app/messages?thread=${r.threadId}`} className="shrink-0 text-sm underline">Open</Link>
            </div>
            <p className="mt-2 text-xs text-[var(--ds-on-surface-variant)]">{r.seen ? "Seen" : "Not seen yet"} · {r.replied ? "Replied" : "No reply"}</p>
          </li>
        ))}
      </ul>
      <div className="mt-3 hidden overflow-x-auto rounded-3xl bg-[var(--ds-surface-container-low)] p-2 sm:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Families and where each conversation stands</caption>
          <thead className="text-xs text-[var(--ds-on-surface-muted)]"><tr><th className="px-3 py-2 font-normal">Student</th><th className="px-3 py-2 font-normal">Class</th><th className="px-3 py-2 font-normal">Seen</th><th className="px-3 py-2 font-normal">Replied</th><th className="px-3 py-2"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {b.rows.map((r) => (
              <tr key={r.threadId} className="hover:bg-white/[0.03]">
                <td className="px-3 py-2">{r.student}</td><td className="px-3 py-2 text-[var(--ds-on-surface-muted)]">{r.label}</td>
                <td className="px-3 py-2">{r.seen ? "Seen" : "Not yet"}</td><td className="px-3 py-2">{r.replied ? "Replied" : "No"}</td>
                <td className="px-3 py-2 text-right"><Link href={`/app/messages?thread=${r.threadId}`} className="underline">Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!b.rows.length ? <p className="mt-3 rounded-3xl bg-[var(--ds-surface-container-low)] p-6 text-center text-sm text-[var(--ds-on-surface-muted)]">No conversations in this send.</p> : null}
      <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Sent {relative(b.createdAt)}.</p>
    </>
  );
}

export async function BatchListPage() {
  const rows = await new BatchService(await requireCtx()).list();
  return (
    <>
      <PageHeader eyebrow="Message families" title="Sent to families" description="Every send, with how many families saw it and answered."
        actions={<Link href="/app/messages/families" className={PILL_BTN}>Message families</Link>} />
      {rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((b) => (
            <li key={b.id}><Link href={`/app/messages/families/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/[0.04] p-4 hover:bg-white/[0.07]">
              <span className="min-w-0"><span className="block truncate text-sm text-[var(--ds-on-surface)]">{b.subject}</span><span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{b.audienceLabel}, {shortDate(b.createdAt)}</span></span>
              <span className="text-sm tabular-nums text-[var(--ds-on-surface-variant)]">{b.seen} seen, {b.replied} replied, of {b.total}</span>
            </Link></li>
          ))}
        </ul>
      ) : <UnreadFallback title="Nothing sent yet" text="When you message a section or a group of families, each send shows here." href="/app/messages/families" label="Message families" />}
    </>
  );
}
