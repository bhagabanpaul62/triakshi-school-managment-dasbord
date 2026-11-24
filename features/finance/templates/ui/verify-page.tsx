import type { Metadata } from "next";
import { getSchool } from "@smw/runtime";
import { formatPaise } from "@smw/ui/finance/logic";
import { checkDocument, type VerifyLookups } from "../verify";

export const verifyMetadata: Metadata = { title: "Check a document", robots: { index: false, follow: false } };

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const KIND_WORD: Record<string, string> = { receipt: "receipt", invoice: "invoice" };

function Shell({ school, children }: { school: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <section className="w-full max-w-md rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
        <p className="text-xs uppercase tracking-wide text-[var(--ds-on-surface-muted)]">{school}</p>
        {children}
        <a href="/" className="mt-6 inline-flex h-10 items-center rounded-full bg-white/[0.08] px-5 text-sm hover:bg-white/[0.12]">Go to the school website</a>
      </section>
    </main>
  );
}

/**
 * The page a QR code opens: no sign-in, one school (the host's own), and only the status, number, date, amount and a
 * masked name. `limited` comes from the route, which owns the per-IP rate limit. A bad kind, a bad token and an unknown
 * token all show the same "not found".
 */
export default async function VerifyPage({ params, lookups, limited }: { params: Promise<{ kind: string; token: string }>; lookups: VerifyLookups; limited: boolean }) {
  const [school, { kind, token }] = [await getSchool(), await params];
  if (limited) {
    return <Shell school={school.name}><h1 className="mt-2 text-2xl font-medium tracking-tight">Too many checks</h1><p className="mt-2 text-sm text-[var(--ds-on-surface-muted)]">Please wait a few minutes and scan the code again.</p></Shell>;
  }
  const doc = await checkDocument(lookups, school.id, kind, token);
  if (!doc) {
    return (
      <Shell school={school.name}>
        <h1 className="mt-2 text-2xl font-medium tracking-tight">We could not find this document</h1>
        <p className="mt-2 text-sm text-[var(--ds-on-surface-muted)]">The code may be damaged or copied wrongly. Scan it again, or ask the school office to check the number printed on your copy.</p>
      </Shell>
    );
  }
  return (
    <Shell school={school.name}>
      <h1 className="mt-2 text-2xl font-medium tracking-tight">{doc.ok ? `This ${KIND_WORD[kind] ?? "document"} is genuine` : `This ${KIND_WORD[kind] ?? "document"} is ${doc.status.toLowerCase()}`}</h1>
      <dl className="mt-5 grid gap-3 text-sm">
        {([["Status", doc.status], ["Number", doc.number], ["Date", day(doc.date)], ["Amount", formatPaise(doc.amountPaise, { fixed: true })], ...(doc.maskedName ? [["Name", doc.maskedName]] : [])] as [string, string][]).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4"><dt className="text-[var(--ds-on-surface-muted)]">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>
        ))}
      </dl>
    </Shell>
  );
}
