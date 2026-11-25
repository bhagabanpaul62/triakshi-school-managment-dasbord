import { requireCtx } from "@smw/runtime";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { VersionService } from "../service";
import { VersionsClient } from "./versions-client";
import { WebsiteNav } from "./website-nav";

export const metadata = { title: "Website versions" };

export default async function VersionsPage() {
  const ctx = await requireCtx();
  const svc = new VersionService(ctx);
  if (!svc.canSee()) return <NoAccess title="You cannot open the website screens." hint="Ask your admin to give your role access to the website." />;
  const rows = await svc.list();
  return (
    <>
      <PageHeader eyebrow="Website" title="Versions" description="Every time the website is published, a copy is kept here. Bring any of them back as your draft." />
      <WebsiteNav />
      <VersionsClient canManage={svc.can("manage") && !ctx.readOnly}
        rows={rows.map((r) => ({ number: r.number, kind: r.kind, name: r.name ?? "", changes: r.changes, byName: r.byName ?? "", at: r.createdAt.toISOString(), live: r.live }))} />
    </>
  );
}
