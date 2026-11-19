import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import type { SectionType } from "@smw/site-templates";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { Button } from "@smw/ui/ui/button";
import { shortDate } from "@smw/ui/format";
import { EnquiryService, SiteService } from "../service";
import { publishSite } from "./actions";
import { SiteEditor } from "./site-editor";

export const metadata = { title: "Website" };

/** Sections that fill themselves from another part of the panel: where to change what they show. */
const SOURCE: Partial<Record<SectionType, { feature: string; href: string; label: string }>> = {
  news: { feature: "announcements", href: "/app/announcements", label: "It shows your public announcements. Manage them." },
  events: { feature: "events", href: "/app/events", label: "It shows your public events. Manage them." },
  staff: { feature: "staff", href: "/app/staff", label: "It shows your teachers. Manage staff." },
  admission_form: { feature: "website", href: "/app/enquiries", label: "Enquiries land in your list." },
};

export default async function WebsitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new SiteService(ctx);
  const site = await svc.get();
  const canManage = svc.can("manage");
  const sp = await searchParams;
  const want = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const page = site.draft.pages.find((p) => p.slug === want) ?? site.draft.pages[0]!;
  const dirty = SiteService.hasUnpublishedChanges(site);
  const change = SiteService.changes(site);
  const newEnquiries = await new EnquiryService(ctx).counts().then((c) => c.new).catch(() => null);
  const publishBody = change.first
    ? "Your website is not live yet. Publishing puts all pages on your school address for every visitor."
    : change.lines.length ? `Visitors will see this straight away. ${change.lines.join(". ")}.` : "Nothing has changed since the last publish.";
  const sources = Object.fromEntries(Object.entries(SOURCE).filter(([, s]) => ctx.features.has(s.feature)).map(([k, s]) => [k, { href: s.href, label: s.label }]));
  const status = dirty
    ? (change.first ? "Not live yet. Publish to put it on your school address." : `Visitors still see the last published version. ${change.lines.join(". ")}`)
    : `Visitors see exactly what is here${site.publishedAt ? `, published ${shortDate(site.publishedAt)}` : ""}.`;

  return (
    <>
      <PageHeader eyebrow="Website" title="Website"
        description={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ToneBadge label={dirty ? "Draft" : "Live"} tone={dirty ? "warning" : "success"} />
          <span>{status}</span>
          {newEnquiries ? <Link href="/app/enquiries" className="text-[var(--ds-primary)] hover:underline">{newEnquiries} new {newEnquiries === 1 ? "enquiry" : "enquiries"}</Link> : null}
        </span>}
        actions={<>
          {site.publishedAt ? <Button asChild variant="ghost" className="rounded-full"><a href="/" target="_blank" rel="noopener">View live site</a></Button> : null}
          {canManage && dirty ? <ActionButton variant="default" label="Publish" action={publishSite} successMessage="Website published. Visitors see the new version now"
            confirm={{ title: "Publish the website?", body: publishBody, confirmLabel: "Publish" }} /> : null}
        </>} />
      <SiteEditor content={site.draft} template={site.templateKey} canManage={canManage} initialSlug={page.slug} sources={sources} />
    </>
  );
}
