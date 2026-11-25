import { requireCtx } from "@smw/runtime";
import type { SectionType } from "@smw/site-templates";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { SiteService } from "../service";
import { SiteEditor } from "./site-editor";
import { WebsiteNav } from "./website-nav";

export const metadata = { title: "Edit website" };

/** Sections that fill themselves from another part of the panel: where to change what they show. */
const SOURCE: Partial<Record<SectionType, { feature: string; href: string; label: string }>> = {
  news: { feature: "announcements", href: "/app/announcements", label: "It shows your public announcements. Manage them." },
  events: { feature: "events", href: "/app/events", label: "It shows your public events. Manage them." },
  staff: { feature: "staff", href: "/app/staff", label: "It shows your teachers. Choose whose names show under Settings." },
  admission_form: { feature: "website", href: "/app/enquiries", label: "Enquiries land in your list." },
  contact_form: { feature: "website", href: "/app/enquiries", label: "Questions land in your Enquiries list." },
};

export default async function EditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new SiteService(ctx);
  if (!svc.canSee()) return <NoAccess title="You cannot open the website editor." hint="Ask your admin to give your role access to the website." />;
  const [site, info, limit] = await Promise.all([svc.get(), svc.draftInfo(), svc.pageLimit()]);
  const sp = await searchParams;
  const want = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const page = site.draft.pages.find((p) => p.slug === want) ?? site.draft.pages[0]!;
  const sources = Object.fromEntries(Object.entries(SOURCE).filter(([, s]) => ctx.features.has(s.feature)).map(([k, s]) => [k, { href: s.href, label: s.label }]));
  return (
    <>
      <PageHeader eyebrow="Website" title="Edit" description={svc.can("manage") ? "Change words and photos. Visitors see nothing until you publish." : "You can look at the draft. Editing is for people your admin has given that right."}
        actions={<a href="/app/website" className={PILL_BTN}>Publish or schedule</a>} />
      <WebsiteNav />
      <SiteEditor content={site.draft} template={site.templateKey} canManage={svc.can("manage") && !ctx.readOnly} initialSlug={page.slug} sources={sources} meId={ctx.userId} draft={info} pageLimit={limit} />
    </>
  );
}
