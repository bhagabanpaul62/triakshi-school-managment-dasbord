// The public face of the module. Other features and the app import from here.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { SchoolService, toPage, listQuerySchema, type Ctx, type ListQuery, type Page } from "@smw/feature-kit";
import { markdownToText } from "@smw/ui/markdown";
import announcementsFeature from "./feature";
import { FeedService } from "./feed-service";
import { announcementCategories, announcements } from "./schema";
import type { NoticeType } from "./constants";

/** What dashboards, the website and the API read: a sent notice, with `pinned` worked out from its "pin until" time. */
export interface Announcement { id: string; type: NoticeType; number: string | null; title: string; body: string; excerpt: string; publishedAt: Date | null; pinned: boolean; categoryName: string | null }

type Row = { n: typeof announcements.$inferSelect; cat: string | null };
const shape = ({ n, cat }: Row): Announcement => ({
  id: n.id, type: n.type, number: n.number, title: n.title, body: n.body, excerpt: markdownToText(n.body, 160), publishedAt: n.publishedAt,
  pinned: !!n.pinnedUntil && n.pinnedUntil.getTime() > Date.now(), categoryName: cat,
});

/** Only a notice meant for everyone, or for the website alone, may ever be public. Checked here as well as when it is saved. */
const publicOnly = sql`(${announcements.website} and (${announcements.audience}->'include' = '[]'::jsonb or (${announcements.audience}->'exclude' = '[]'::jsonb and ${announcements.audience}->'include' @> '[{"type":"everyone"}]'::jsonb)))`;

/** Sent notices for dashboards, the website and the API. Writing and answering live in NoticeService, FeedService and ResponseService. */
export class AnnouncementService extends SchoolService<keyof typeof announcementsFeature.permissions> {
  protected feature = announcementsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  private seen() { return new FeedService(this.ctx); }

  /** What this person may see, newest first. Staff: their own and those sent to them (all for managers). A family: what was sent to them. */
  async list(query: ListQuery = {}): Promise<Page<Announcement>> {
    const q = listQuerySchema.parse(query);
    const { rows, total } = await this.sentToMe(q.pageSize, (q.page - 1) * q.pageSize, q.q);
    return toPage(rows, total, q);
  }

  /** Latest for dashboards: pinned first. */
  async latest(limit = 5): Promise<Announcement[]> { return (await this.sentToMe(limit, 0, undefined, ["published"])).rows; }

  private sentToMe(limit: number, offset: number, search?: string, states = ["published", "expired"]) {
    return this.read("read", async (tx) => {
      const mine = sql`exists (select 1 from announcement_recipients r where r.announcement_id = ${announcements.id} and r.user_id = ${this.ctx.userId}::uuid and r.removed_at is null)`;
      const scope = this.can("manage") ? undefined : this.ctx.role === "student" ? mine : sql`(${mine} or ${announcements.createdBy} = ${this.ctx.userId}::uuid)`;
      const where = and(inArray(announcements.state, states as (typeof announcements.$inferSelect.state)[]), scope, search ? sql`(${announcements.title} ilike ${`%${search}%`} or ${announcements.body} ilike ${`%${search}%`})` : undefined);
      const pinned = sql`(${announcements.pinnedUntil} is not null and ${announcements.pinnedUntil} > now())`;
      const [rows, [t]] = await Promise.all([
        tx.select({ n: announcements, cat: announcementCategories.name }).from(announcements).leftJoin(announcementCategories, eq(announcementCategories.id, announcements.categoryId))
          .where(where).orderBy(desc(pinned), desc(announcements.publishedAt), asc(announcements.id)).limit(limit).offset(offset),
        tx.select({ n: sql<number>`count(*)::int` }).from(announcements).where(where),
      ]);
      return { rows: rows.map(shape), total: Number(t?.n ?? 0) };
    });
  }

  /** Public news for the school website (no login). Only a published notice for everyone, put on the website by someone allowed, and not past its end date. */
  async publicNews(limit = 6): Promise<Announcement[]> {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ n: announcements, cat: announcementCategories.name }).from(announcements).leftJoin(announcementCategories, eq(announcementCategories.id, announcements.categoryId))
        .where(and(eq(announcements.state, "published"), publicOnly, sql`(${announcements.expiresAt} is null or ${announcements.expiresAt} > now())`))
        .orderBy(desc(sql`(${announcements.pinnedUntil} is not null and ${announcements.pinnedUntil} > now())`), desc(announcements.publishedAt)).limit(limit);
      return rows.map(shape);
    });
  }

  /** Notices sent to me that I have not opened. */
  unread() { return this.seen().unreadCount(); }
}

export { NoticeService } from "./notice-service";
export type { NoticeRow, NoticeView } from "./notice-service";
export { FeedService } from "./feed-service";
export type { FeedItem, FeedNotice } from "./feed-service";
export { ResponseService } from "./response-service";
export { ReportService, remindUnanswered } from "./report-service";
export type { Funnel, PersonRow, SectionRow } from "./report-service";
export { CircularService } from "./circular-pdf";
export type { RegisterRow } from "./circular-pdf";
export { NoticeFileService } from "./files";
export type { UploadedFile } from "./files";
export { AnnouncementCategoryService, TemplateService, DEFAULT_CATEGORIES, READY_TEMPLATES } from "./category-template-service";
export type { TemplateRow, TemplateDraft } from "./category-template-service";
export { fanOut } from "./fan-out";
export { announcementsVerifyLookups } from "./verify";
export { checkAnswer, answerText } from "./answer";
export { transition, TRANSITIONS, ACTIONS } from "./state";
export type { Notice } from "./content";
