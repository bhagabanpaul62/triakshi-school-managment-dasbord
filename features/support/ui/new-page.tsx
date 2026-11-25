import { headers } from "next/headers";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { articleBySlug } from "../articles";
import { TICKET_CATEGORIES, type TicketCategory } from "../inputs";
import { browserName, ticketRef } from "../labels";
import { SupportService } from "../service";
import { createTicket, suggestArticles } from "./actions";
import { TicketForm } from "./ticket-form";

export const metadata = { title: "New ticket" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** The path of a same-app page, never its query: a link in the address bar may carry a name. */
const pathOf = (v: string | null | undefined) => { try { const p = v ? new URL(v, "http://x").pathname : ""; return /^\/app(\/|$)/.test(p) && !p.startsWith("/app/support") ? p.slice(0, 200) : null; } catch { return null; } };

/** /app/support/new: its own page. Category, subject, details, files, priority in words; the page and browser we caught are shown and can be removed. */
export default async function NewTicketPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new SupportService(ctx);
  if (!svc.can("use")) return <NoAccess title="Triakshi support is for your school's staff." hint="Ask your school office. They can write to us for you." />;
  if (ctx.supportStaffId && ctx.readOnly) return <NoAccess title="This is a read-only support session." hint="A new ticket cannot be sent from here. Ask the school to write it." />;
  const sp = await searchParams;
  const h = await headers();
  const article = articleBySlug(one(sp.article) ?? "");
  const category = (TICKET_CATEGORIES as readonly string[]).includes(one(sp.category) ?? "") ? (one(sp.category) as TicketCategory) : "question";
  let followUp: { id: string; ref: string } | null = null;
  const prev = one(sp.followUp);
  if (prev) { try { const t = (await svc.thread(prev)).ticket; followUp = { id: t.id, ref: ticketRef(t.number) }; } catch { followUp = null; } }
  const page = pathOf(one(sp.from)) ?? pathOf(h.get("referer"));

  return (
    <>
      <PageHeader eyebrow="Support" title="New ticket" description="Tell us what happened. We reply here, and tell you in the bell, by push and by email." />
      <TicketForm action={createTicket} suggest={suggestArticles} canAsk
        defaults={{ subject: (one(sp.subject) ?? "").slice(0, 150), category, article: article?.slug ?? null, articleTitle: article?.title ?? null }}
        context={{ page, browser: browserName(h.get("user-agent")) ?? null }} followUp={followUp} />
    </>
  );
}
