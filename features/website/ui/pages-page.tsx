import { requireCtx } from "@smw/runtime";
import { lastChange, stableJson, stripMeta } from "@smw/site-templates";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { SiteService } from "../service";
import { liveOrigin } from "./address";
import { PagesClient, type PageRow } from "./pages-client";
import { WebsiteNav } from "./website-nav";

export const metadata = { title: "Pages and menu" };

export default async function PagesPage() {
  const ctx = await requireCtx();
  const svc = new SiteService(ctx);
  if (!svc.canSee()) return <NoAccess title="You cannot open the website screens." hint="Ask your admin to give your role access to the website." />;
  const [site, limit, origin] = await Promise.all([svc.get(), svc.pageLimit(), liveOrigin()]);
  const live = new Map((site.published ? stripMeta(site.published).pages : []).map((p) => [p.slug, p]));
  const inMenu = new Set(site.draft.nav.flatMap((n) => [n.slug, ...(n.children ?? []).map((c) => c.slug)]));
  const rows: PageRow[] = site.draft.pages.map((p) => {
    const was = live.get(p.slug);
    const state = p.hidden ? "hidden" : !site.published || !was ? "draft_only" : stableJson(was) === stableJson(stripMeta({ ...site.draft, pages: [p] }).pages[0]) ? "live" : "changed";
    const last = lastChange(p);
    return { lastBy: last?.by ?? "", lastAt: last?.at ?? "", slug: p.slug, title: p.title, intro: p.intro ?? "", state, sections: p.sections.length, noindex: !!p.noindex, hidden: !!p.hidden, inMenu: inMenu.has(p.slug),
      seoTitle: p.seo.title ?? "", seoDescription: p.seo.description ?? "", seoImageUrl: p.seo.imageUrl ?? "" };
  });
  return (
    <>
      <PageHeader eyebrow="Website" title="Pages and menu" description="Your pages, their web addresses and the menu on top. Changes wait in the draft until you publish." />
      <WebsiteNav />
      <PagesClient pages={rows} nav={site.draft.nav} footer={site.draft.footer} limit={limit} canManage={svc.can("manage") && !ctx.readOnly} host={origin.replace(/^https?:\/\//, "")} />
    </>
  );
}
