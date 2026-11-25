import { requireCtx } from "@smw/runtime";
import { dateTime } from "@smw/ui/format";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { SiteService, SiteSettingsService } from "../service";
import { SettingsClient } from "./settings-client";
import { WebsiteNav } from "./website-nav";

export const metadata = { title: "Website settings" };

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const svc = new SiteSettingsService(ctx);
  if (!svc.canSee()) return <NoAccess title="You cannot open the website screens." hint="Ask your admin to give your role access to the website." />;
  const [settings, teachers, redirects, publishers, site] = await Promise.all([svc.get(), svc.teachers(), svc.redirects(), svc.publishers(), new SiteService(ctx).get()]);
  return (
    <>
      <PageHeader eyebrow="Website" title="Settings" description="These apply at once. They do not wait for a publish." />
      <WebsiteNav />
      <SettingsClient settings={settings} canManage={svc.can("manage") && !ctx.readOnly} canPublish={svc.can("publish") && !ctx.readOnly}
        teachers={teachers} publishers={publishers} offlineSince={site.offlineAt ? dateTime(site.offlineAt) : null}
        redirects={redirects.map((r) => ({ id: r.id, from: r.fromPath, to: r.toPath, automatic: r.automatic }))} />
    </>
  );
}
