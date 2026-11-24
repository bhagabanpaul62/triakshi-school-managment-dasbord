import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { qrSvg } from "@smw/integrations";
import { EmptyLine } from "@smw/ui/finance/States";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import financeFeature from "../../feature";
import { KINDS, type DocumentKind } from "../config";
import { TemplateService } from "../service";
import { TemplateEditor } from "./template-editor";

export const metadata = { title: "Document layouts" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const WORDS: Record<string, string> = { admin: "administrators", accountant: "accountants" };
const when = (d: Date) => d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** The layout editor. `?kind=` picks the tab, `?next=` (an /app/ path) adds a way back to where the person came from. */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new TemplateService(ctx);
  if (!svc.can("read")) {
    return <EmptyLine title="Document layouts are for the school's finance team." hint="Ask an administrator if you need to see them." action={<Link href="/app" className="text-sm underline">Go to the home page</Link>} />;
  }
  const sp = await searchParams;
  const kind: DocumentKind = KINDS.find((k) => k === one(sp.kind)) ?? "receipt";
  const next = one(sp.next)?.startsWith("/app/") ? one(sp.next) : undefined;
  const [view, versions, context] = await Promise.all([svc.current(kind), svc.versions(kind), svc.editorContext()]);
  const editors = financeFeature.permissions.settings.map((r) => WORDS[r] ?? `${r}s`).join(" and ");

  return (
    <>
      <PageHeader eyebrow="Finance setup" title="Document layouts" description="How receipts, invoices, statements, certificates, payslips and vouchers look when printed. Every save is a new version, so old documents reprint as they were issued."
        actions={next ? <Link href={next} className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.12]">Back to where you were</Link> : !context.canEdit ? null : <Link href="/app/finance/settings" className="inline-flex h-10 shrink-0 whitespace-nowrap items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.12]">Finance setup</Link>} />
      <TemplateEditor key={`${kind}:${view.version}`} kind={kind} version={view.version} initial={view.config} canEdit={context.canEdit} editors={editors}
        schoolLogoUrl={context.schoolLogoUrl} next={next} qrSvg={qrSvg("https://school.example/verify/receipt/sample-token-0000")}
        versions={versions.map((v) => ({ version: v.version, when: when(v.createdAt), by: v.createdBy, isCurrent: v.isCurrent }))} />
    </>
  );
}
