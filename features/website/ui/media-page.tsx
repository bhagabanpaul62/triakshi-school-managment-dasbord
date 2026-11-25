import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { MediaService } from "../service";
import { MediaClient } from "./media-client";
import { WebsiteNav } from "./website-nav";

export const metadata = { title: "Website media" };
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function MediaPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireCtx();
  const svc = new MediaService(ctx);
  if (!svc.canSee()) return <NoAccess title="You cannot open the website screens." hint="Ask your admin to give your role access to the website." />;
  const sp = await searchParams;
  const kind = one(sp.kind) === "photo" || one(sp.kind) === "document" ? (one(sp.kind) as "photo" | "document") : undefined;
  const unused = one(sp.filter) === "unused";
  const items = await svc.list({ q: one(sp.q), kind, unused });
  return (
    <>
      <PageHeader eyebrow="Website" title="Media" description={<>Photos and documents of your website. <Link href="/app/theme" className="text-[var(--ds-primary-text)] hover:underline">The logo lives under Theme.</Link></>} />
      <WebsiteNav />
      <MediaClient canManage={svc.can("manage") && !ctx.readOnly} view={one(sp.view) === "list" ? "list" : "grid"} q={one(sp.q) ?? ""} kind={kind ?? ""} unused={unused}
        items={items.map((i) => ({ id: i.id, kind: i.kind, url: i.url, viewUrl: i.viewUrl, fileName: i.fileName, size: i.size, alt: i.alt ?? "", places: i.places }))} />
    </>
  );
}
