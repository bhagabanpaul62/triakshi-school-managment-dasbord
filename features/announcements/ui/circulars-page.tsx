import { notFound } from "next/navigation";
import { ForbiddenError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { SavedViews } from "@smw/ui/comm/SavedViews";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { dateTime } from "@smw/ui/format";
import type { Tone } from "@smw/ui/tone";
import { AnnouncementCategoryService, CircularService, type RegisterRow } from "../service";
import { BackLink, HOME, LinkButton, Notice, one, STATE_LABEL, STATE_TONE, type Query } from "./shared";

export const metadata = { title: "Circular register" };
const PAGE = 50;
const columns: Column[] = [
  { key: "number", label: "Number", type: "mono" },
  { key: "title", label: "Title" },
  { key: "date", label: "Date" },
  { key: "category", label: "Category", type: "badge", hideOnMobile: true },
  { key: "author", label: "By", hideOnMobile: true },
  { key: "state", label: "State", type: "badge", labels: STATE_LABEL, tones: STATE_TONE },
  { key: "note", label: "Note", hideOnMobile: true },
];
const SENT = new Set(["sending", "published", "expired", "withdrawn"]);

/** /app/circulars: every circular number of a session, withdrawn ones too, so the numbers show no gap. */
export default async function CircularsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const [ctx, sp] = await Promise.all([requireCtx(), searchParams]);
  if (ctx.role === "student" || ctx.role === "parent") notFound();
  const svc = new CircularService(ctx);
  let sessions: string[];
  try { sessions = await svc.sessions(); } catch (e) {
    if (e instanceof ForbiddenError) return <><BackLink href={HOME}>Notices</BackLink><Notice tone="warning">The circular register is for admins and approvers. Ask the school admin if you need to see it.</Notice></>;
    throw e;
  }
  const session = sessions.includes(one(sp.session) ?? "") ? one(sp.session)! : sessions[0]!;
  const [reg, categories] = await Promise.all([svc.register(session), new AnnouncementCategoryService(ctx).options()]);
  const q = (one(sp.q) ?? "").trim().toLowerCase(), page = Math.max(1, Number(one(sp.page)) || 1);
  const found = reg.rows.filter((r) => !q || `${r.number} ${r.title}`.toLowerCase().includes(q));
  const shown = found.slice((page - 1) * PAGE, page * PAGE);
  const tones = Object.fromEntries(categories.map((c) => [c.name, c.tone as Tone]));
  const rows = shown.map((r: RegisterRow) => ({ id: r.id, number: r.number, title: r.title, date: r.date ? dateTime(r.date).split(",")[0] : null, category: r.categoryName, author: r.authorName, state: r.state, note: r.withdrawReason }));
  const write = <LinkButton href={`${HOME}/new?type=circular`} primary>Write a circular</LinkButton>;
  return (
    <>
      <BackLink href={HOME}>Notices</BackLink>
      <PageHeader eyebrow="Communication" title="Circular register" description={`Session ${reg.session}: ${reg.rows.length} ${reg.rows.length === 1 ? "number" : "numbers"}.`}
        actions={<><LinkButton href={`/api/notices/register?session=${encodeURIComponent(reg.session)}`}>Print the register</LinkButton>{ctx.readOnly ? null : write}</>} />
      <div className="flex flex-col gap-3">
        <SavedViews views={sessions.map((s) => ({ key: s, label: s }))} active={session} basePath="/app/circulars" param="session" label="Session" params={{ q: one(sp.q) }} />
        <DataTable columns={columns.map((c) => (c.key === "category" ? { ...c, tones } : c))} rows={rows} total={found.length} page={page} pageCount={Math.max(1, Math.ceil(found.length / PAGE))} rowHref={`${HOME}/{id}`}
          searchPlaceholder="Search number or title"
          rowActions={Object.fromEntries(shown.map((r) => [r.id, SENT.has(r.state) ? <LinkButton key={r.id} href={`/api/notices/${r.id}/circular`}>PDF</LinkButton> : null]))}
          empty={{ title: `No circulars in ${reg.session} yet.`, description: "A circular gets its number when it is published. Numbers are never reused, even when one is withdrawn.", action: ctx.readOnly ? undefined : write }} />
      </div>
    </>
  );
}
