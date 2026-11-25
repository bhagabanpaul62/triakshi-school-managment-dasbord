import { z } from "zod";
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { NotFoundError } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { markdownToText } from "@smw/ui/markdown";
import { NoticeBase } from "./base";
import type { Answer, NoticeType, ResponseSpec } from "./constants";
import { subjectOf } from "./fan-out";
import { NoticeFileService } from "./files";
import { feedInput, type FeedQuery } from "./inputs";
import { announcementCategories, announcementFiles, announcementRecipients, announcementResponses, announcements } from "./schema";

export interface FeedItem {
  noticeId: string; recipientId: string; title: string; excerpt: string; type: NoticeType; number: string | null; urgent: boolean; pinned: boolean;
  categoryName: string | null; categoryTone: string | null; publishedAt: Date | null; correctedAt: Date | null; seen: boolean;
  /** An answer is wanted and not given, and the notice is still open. */
  needsAnswer: boolean; answered: boolean; dueAt: Date | null; responseKind: ResponseSpec["kind"]; withdrawn: boolean;
  /** The child it was sent for, so a login with two children can tell the rows apart. */
  childName: string | null;
}

export interface FeedNotice {
  id: string; type: NoticeType; number: string | null; urgent: boolean; version: number; publishedAt: Date | null; correctedAt: Date | null; state: string;
  category: { name: string; tone: string } | null;
  /** The words in the language shown, and the other language when the notice has one. `lang` null = the school's main language. */
  content: { lang: string | null; title: string; body: string } | null;
  other: { lang: string | null; title: string; body: string } | null;
  withdrawn: { reason: string; at: Date } | null;
  files: { id: string; name: string; size: number; contentType: string }[];
  response: ResponseSpec; dueAt: Date | null;
  /** open: may answer or change; locked: the due date passed; closed: expired or withdrawn; none: nothing is asked. */
  answering: "open" | "locked" | "closed" | "none";
  /** One per child this login is the family of, with the answer given so far. */
  recipients: { recipientId: string; name: string; seenAt: Date | null; answer: null | { answer: Answer; byName: string; byRelation: string; onPaper: boolean; at: Date } }[];
}

const kindOf = announcements.response;
const needsAnswer = sql`(${announcements.state} = 'published' and ${kindOf}->>'kind' <> 'none' and ${announcementResponses.id} is null and (${announcements.dueAt} is null or ${announcements.dueAt} > now()))`;
const pinned = sql`(${announcements.pinnedUntil} is not null and ${announcements.pinnedUntil} > now())`;
const fresh = sql`${announcements.withdrawnAt} > now() - interval '14 days'`;

/** What a reader (a family login or staff) sees of the notices sent to them, and the act of opening one. */
export class FeedService extends NoticeBase {
  async feed(query: FeedQuery = {}): Promise<{ rows: FeedItem[]; total: number; page: number; pageSize: number; pageCount: number; unread: number }> {
    const q = this.parse(feedInput, query);
    return this.read("read", async (tx) => {
      const tab = q.tab === "inbox"
        ? or(eq(announcements.state, "published"), and(eq(announcements.state, "withdrawn"), fresh))
        : or(eq(announcements.state, "expired"), and(eq(announcements.state, "withdrawn"), sql`not ${fresh}`));
      const where = and(eq(announcementRecipients.userId, this.ctx.userId), isNull(announcementRecipients.removedAt), tab,
        q.category ? eq(announcements.categoryId, q.category) : undefined, q.q ? or(ilike(announcements.title, `%${q.q}%`), ilike(announcements.body, `%${q.q}%`)) : undefined);
      const base = () => tx.select({
        a: announcements, rid: announcementRecipients.id, seenAt: announcementRecipients.seenAt, child: announcementRecipients.name, studentId: announcementRecipients.studentId,
        cat: announcementCategories.name, tone: announcementCategories.tone, answered: sql<boolean>`${announcementResponses.id} is not null`, needs: sql<boolean>`${needsAnswer}`, pin: sql<boolean>`${pinned}`,
      }).from(announcementRecipients).innerJoin(announcements, eq(announcements.id, announcementRecipients.announcementId))
        .leftJoin(announcementCategories, eq(announcementCategories.id, announcements.categoryId)).leftJoin(announcementResponses, eq(announcementResponses.recipientId, announcementRecipients.id)).where(where);
      const [rows, total, unread] = await Promise.all([
        base().orderBy(desc(sql`${needsAnswer}`), desc(sql`${pinned}`), desc(announcements.publishedAt), asc(announcements.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(announcementRecipients).innerJoin(announcements, eq(announcements.id, announcementRecipients.announcementId)).where(where),
        this.unreadIn(tx),
      ]);
      const mine = new Map<string, number>();
      for (const r of rows) mine.set(r.a.id, (mine.get(r.a.id) ?? 0) + 1);
      return {
        rows: rows.map(({ a, rid, seenAt, child, studentId, cat, tone, answered, needs, pin }): FeedItem => {
          const gone = a.state === "withdrawn";
          return {
            noticeId: a.id, recipientId: rid, title: gone ? "Withdrawn by the school" : a.title, excerpt: gone ? a.withdrawReason ?? "" : markdownToText(a.body, 160), type: a.type, number: a.number,
            urgent: a.type === "urgent", pinned: pin, categoryName: cat, categoryTone: tone, publishedAt: a.publishedAt, correctedAt: a.correctedAt, seen: !!seenAt, needsAnswer: needs, answered,
            dueAt: a.dueAt, responseKind: a.response.kind, withdrawn: gone, childName: studentId && (mine.get(a.id) ?? 0) > 1 ? child : null,
          };
        }),
        total: Number(total[0]?.n ?? 0), page: q.page, pageSize: q.pageSize, pageCount: Math.max(1, Math.ceil(Number(total[0]?.n ?? 0) / q.pageSize)), unread,
      };
    });
  }

  private async unreadIn(tx: Tx) {
    const [r] = await tx.select({ n: count() }).from(announcementRecipients).innerJoin(announcements, eq(announcements.id, announcementRecipients.announcementId))
      .where(and(eq(announcementRecipients.userId, this.ctx.userId), isNull(announcementRecipients.removedAt), isNull(announcementRecipients.seenAt), eq(announcements.state, "published")));
    return Number(r?.n ?? 0);
  }

  /** Urgent alerts sent to me that I have not opened: the red banner in the panel stays until each is opened. */
  urgentUnopened(): Promise<{ id: string; title: string }[]> {
    return this.read("read", (tx) => tx.select({ id: announcements.id, title: announcements.title }).from(announcementRecipients).innerJoin(announcements, eq(announcements.id, announcementRecipients.announcementId))
      .where(and(eq(announcementRecipients.userId, this.ctx.userId), isNull(announcementRecipients.removedAt), isNull(announcementRecipients.seenAt), eq(announcements.state, "published"), eq(announcements.type, "urgent")))
      .orderBy(desc(announcements.publishedAt)).limit(3));
  }

  /** Notices sent to me that I have not opened. */
  unreadCount(): Promise<number> { return this.read("read", (tx) => this.unreadIn(tx)); }

  /**
   * Open a notice sent to me: marks it seen (the bell row goes with it, and its pending push and email) and returns what to show.
   * In a support session nothing is marked and no answer is shown. `lang` picks the second language when the notice has one.
   */
  async open(noticeId: string, o: { lang?: string | null } = {}): Promise<FeedNotice> {
    const id = z.uuid().parse(noticeId);
    return this.read("read", async (tx) => {
      const mine = await tx.select().from(announcementRecipients).where(and(eq(announcementRecipients.announcementId, id), eq(announcementRecipients.userId, this.ctx.userId), isNull(announcementRecipients.removedAt)));
      const [n] = mine.length ? await tx.select().from(announcements).where(eq(announcements.id, id)) : [];
      if (!n) throw new NotFoundError("Notice");
      if (!this.inSupport) {
        await tx.update(announcementRecipients).set({ seenAt: sql`coalesce(${announcementRecipients.seenAt}, now())` }).where(and(eq(announcementRecipients.announcementId, id), eq(announcementRecipients.userId, this.ctx.userId)));
        await NotificationWriter.seen(tx, this.ctx.schoolId, subjectOf(id), this.ctx.userId);
      }
      const [[cat], files, answers, pref] = await Promise.all([
        n.categoryId ? tx.select({ name: announcementCategories.name, tone: announcementCategories.tone }).from(announcementCategories).where(eq(announcementCategories.id, n.categoryId)) : Promise.resolve([]),
        tx.select().from(announcementFiles).where(eq(announcementFiles.announcementId, id)).orderBy(asc(announcementFiles.sort)),
        this.inSupport ? Promise.resolve([]) : tx.select().from(announcementResponses).where(sql`${announcementResponses.recipientId} in (${sql.join(mine.map((m) => sql`${m.id}`), sql`, `)})`),
        tx.execute(sql`select language from notification_prefs where user_id = ${this.ctx.userId}::uuid limit 1`),
      ]);
      const gone = n.state === "withdrawn";
      const second = n.lang2 && n.title2 && n.body2 ? { lang: n.lang2, title: n.title2, body: n.body2 } : null;
      const main = { lang: null as string | null, title: n.title, body: n.body };
      const wanted = o.lang !== undefined ? o.lang : ([...pref][0] as { language: string | null } | undefined)?.language ?? null;
      const useSecond = !!second && wanted === second.lang;
      const closed = n.state !== "published";
      const locked = !!n.dueAt && n.dueAt.getTime() < Date.now();
      const byId = new Map(answers.map((a) => [a.recipientId, a]));
      return {
        id: n.id, type: n.type, number: n.number, urgent: n.type === "urgent", version: n.version, publishedAt: n.publishedAt, correctedAt: n.correctedAt, state: n.state,
        category: cat ?? null, content: gone ? null : useSecond ? second : main, other: gone || !second ? null : useSecond ? main : second,
        withdrawn: gone ? { reason: n.withdrawReason ?? "", at: n.withdrawnAt ?? n.updatedAt } : null,
        files: gone ? [] : files.map((f) => ({ id: f.id, name: f.fileName, size: f.size, contentType: f.contentType })),
        response: n.response, dueAt: n.dueAt, answering: n.response.kind === "none" ? "none" : closed ? "closed" : locked ? "locked" : "open",
        recipients: mine.map((m) => {
          const a = byId.get(m.id);
          return { recipientId: m.id, name: m.name, seenAt: m.seenAt, answer: a ? { answer: a.answer, byName: a.byName, byRelation: a.byRelation, onPaper: a.onPaper, at: a.updatedAt } : null };
        }),
      };
    });
  }

  /** A 60-second link to a file of a notice sent to me. */
  fileUrl(fileId: string) { return new NoticeFileService(this.ctx).url(fileId); }
}
