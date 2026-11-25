import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DisclosureService } from "../service";
import { DisclosureClient, type PartView } from "./disclosure-client";
import { WebsiteNav } from "./website-nav";

export const metadata = { title: "Mandatory disclosure" };

export default async function DisclosurePage() {
  const ctx = await requireCtx();
  const svc = new DisclosureService(ctx);
  if (!svc.canSee()) return <NoAccess title="You cannot open the website screens." hint="Ask your admin to give your role access to the website." />;
  const v = await svc.get();
  const parts: PartView[] = v.parts.map((p) => ({
    key: p.key, label: p.label, done: p.done, total: p.lines.length,
    lines: p.lines.map((l) => ({ key: l.row.key, label: l.row.label, kind: l.row.kind, expires: !!l.row.expires, state: l.state, days: l.days ?? null, profileText: l.profileText,
      text: l.value?.text ?? "", url: l.value?.url ?? "", fileName: l.value?.fileName ?? "", expiresOn: l.value?.expiresOn ?? "", na: !!l.value?.na })),
  }));
  return (
    <>
      <PageHeader eyebrow="Website" title={v.title}
        description={<>Parents and the board expect these details in one place. We follow the format schools commonly publish; the board changes it, so check the current circular. <Link href="/app/settings/school" className="text-[var(--ds-primary-text)] hover:underline">School details come from Settings.</Link></>} />
      <WebsiteNav />
      <DisclosureClient parts={parts} counts={v.counts} total={v.total} title={v.title} onSite={v.onSite} canManage={svc.can("manage") && !ctx.readOnly} />
    </>
  );
}
