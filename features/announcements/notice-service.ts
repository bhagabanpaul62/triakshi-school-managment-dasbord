import { and, asc, desc, eq, ilike, inArray, or, sql, count, type SQL } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { ConflictError, ForbiddenError, ValidationError, toPage, type Page } from "@smw/feature-kit";
import { audiencePreview, describeAudience } from "@smw/feature-notifications/audience";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { quietUntil } from "@smw/feature-notifications/quiet";
import { publicAudience, contentOf, snapshotOf, readyErrors, plain, EMPTY, NO_AUDIENCE, CONTENT_KEYS, isWebsiteOnly, type Notice, type NoticeContent } from "./content";
import { NoticeBase } from "./base";
import { TAB_STATES, type NoticeCan, type NoticeState, type NoticeTab } from "./constants";
import { fanOut, reconcile, subjectOf, tell } from "./fan-out";
import { approveInput, correctInput, draftInput, listInput, noteInput, reasonInput, type DraftInput, type NoticeListQuery } from "./inputs";
import { labelOf, startSending } from "./lifecycle";
import { announcementCategories, announcementFiles, announcementRecipients, announcementResponses, announcements, announcementVersions } from "./schema";
import { can as canDo, transition } from "./state";
import { FileBin } from "./files";

export interface NoticeRow {
  id: string; type: Notice["type"]; number: string | null; title: string; state: NoticeState; categoryId: string | null; categoryName: string | null; categoryTone: string | null;
  audienceLabel: string; authorId: string | null; authorName: string | null; publishedAt: Date | null; scheduledAt: Date | null; sendAt: Date | null; expiresAt: Date | null; dueAt: Date | null;
  responseKind: Notice["response"]["kind"]; withdrawReason: string | null; version: number; correctedAt: Date | null; updatedAt: Date;
  /** Only for sent notices. */
  recipients: number; seen: number; answered: number;
}

export interface NoticeView {
  notice: Omit<Notice, "verifyHash">;
  category: { id: string; name: string; tone: string } | null;
  authorName: string | null; approvedByName: string | null;
  files: { id: string; name: string; size: number; contentType: string; sort: number }[];
  versions: { version: number; note: string | null; changedByName: string | null; at: Date; snapshot: Record<string, unknown> }[];
  /** What the approver asked or decided, in words. */
  review: { kind: "changes" | "rejected"; note: string } | null;
  approvers: string[];
  /** The audience in words: live for a draft, frozen for a sent notice. */
  audienceText: string;
  /** Live count and who will not be reached; for notices not sent yet. */
  preview: Awaited<ReturnType<typeof audiencePreview>> | null;
  stats: { recipients: number; seen: number; answered: number } | null;
  can: NoticeCan;
}

const REJECTED = "Rejected: ";
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const idList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

/** Notices for staff: write, approve, send, correct, withdraw, and read them with their state. */
export class NoticeService extends NoticeBase {
  // ---------- reading ----------

  async list(query: NoticeListQuery = {}): Promise<Page<NoticeRow>> {
    this.staffOnly();
    const q = this.parse(listInput, query);
    return this.read("read", async (tx) => {
      const where = and(
        inArray(announcements.state, [...TAB_STATES[q.tab]]), this.visible(),
        q.category ? eq(announcements.categoryId, q.category) : undefined, q.type ? eq(announcements.type, q.type) : undefined,
        q.author ? eq(announcements.createdBy, q.author) : undefined, q.needs ? sql`${announcements.response}->>'kind' <> 'none'` : undefined,
        q.q ? or(ilike(announcements.title, `%${q.q}%`), ilike(announcements.body, `%${q.q}%`), ilike(announcements.number, `%${q.q}%`)) : undefined,
      );
      const order = { live: desc(announcements.publishedAt), waiting: asc(announcements.submittedAt), scheduled: asc(announcements.scheduledAt), drafts: desc(announcements.updatedAt), archive: desc(announcements.publishedAt) }[q.tab];
      const [rows, total] = await Promise.all([
        tx.select({ n: announcements, catName: announcementCategories.name, catTone: announcementCategories.tone, author: users.name }).from(announcements)
          .leftJoin(announcementCategories, eq(announcementCategories.id, announcements.categoryId)).leftJoin(users, eq(users.id, announcements.createdBy))
          .where(where).orderBy(order, desc(announcements.createdAt), asc(announcements.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(announcements).where(where),
      ]);
      const sent = rows.filter((r) => r.n.state !== "draft" && r.n.state !== "waiting" && r.n.state !== "scheduled").map((r) => r.n.id);
      const agg = new Map((sent.length ? [...(await tx.execute(sql`select r.announcement_id::text as id, count(*) filter (where r.removed_at is null)::int as recipients,
          count(*) filter (where r.removed_at is null and r.seen_at is not null)::int as seen, count(a.id) filter (where r.removed_at is null)::int as answered
        from announcement_recipients r left join announcement_responses a on a.recipient_id = r.id where r.announcement_id in (${idList(sent)}) group by 1`))] as { id: string; recipients: number; seen: number; answered: number }[] : []).map((a) => [a.id, a]));
      return toPage(rows.map(({ n, catName, catTone, author }): NoticeRow => ({
        id: n.id, type: n.type, number: n.number, title: n.title, state: n.state, categoryId: n.categoryId, categoryName: catName, categoryTone: catTone, audienceLabel: n.audienceLabel,
        authorId: n.createdBy, authorName: author, publishedAt: n.publishedAt, scheduledAt: n.scheduledAt, sendAt: n.sendAt, expiresAt: n.expiresAt, dueAt: n.dueAt, responseKind: n.response.kind,
        withdrawReason: n.withdrawReason, version: n.version, correctedAt: n.correctedAt, updatedAt: n.updatedAt,
        recipients: agg.get(n.id)?.recipients ?? 0, seen: agg.get(n.id)?.seen ?? 0, answered: agg.get(n.id)?.answered ?? 0,
      })), Number(total[0]?.n ?? 0), { page: q.page, pageSize: q.pageSize, dir: "desc", filters: {} });
    });
  }

  /** Numbers for the tabs, over what this person may see. */
  async counts(): Promise<Record<NoticeTab, number>> {
    this.staffOnly();
    return this.read("read", async (tx) => {
      const rows = await tx.select({ state: announcements.state, n: count() }).from(announcements).where(this.visible()).groupBy(announcements.state);
      const by = new Map(rows.map((r) => [r.state, Number(r.n)]));
      return Object.fromEntries((Object.keys(TAB_STATES) as NoticeTab[]).map((t) => [t, TAB_STATES[t].reduce((s, st) => s + (by.get(st) ?? 0), 0)])) as Record<NoticeTab, number>;
    });
  }

  async get(id: string): Promise<NoticeView> {
    this.staffOnly();
    return this.read("read", async (tx) => {
      const n = await this.find(tx, id);
      const { verifyHash: _hidden, ...notice } = n;
      const [[cat], files, versions, names, approvers, reach] = await Promise.all([
        n.categoryId ? tx.select().from(announcementCategories).where(eq(announcementCategories.id, n.categoryId)) : Promise.resolve([]),
        tx.select().from(announcementFiles).where(eq(announcementFiles.announcementId, n.id)).orderBy(asc(announcementFiles.sort), asc(announcementFiles.createdAt)),
        tx.select({ v: announcementVersions, by: users.name }).from(announcementVersions).leftJoin(users, eq(users.id, announcementVersions.changedBy)).where(eq(announcementVersions.announcementId, n.id)).orderBy(desc(announcementVersions.version)),
        tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [n.createdBy, n.approvedBy].filter((x): x is string => !!x))),
        this.approvers(tx),
        n.audience.include.length || isWebsiteOnly(n) ? this.reach(tx, n.audience, "publish").catch(() => null) : Promise.resolve(null),
      ]);
      const name = new Map(names.map((u) => [u.id, u.name]));
      const unsent = n.state === "draft" || n.state === "waiting" || n.state === "scheduled";
      const [stats] = unsent ? [] : [...(await tx.execute(sql`select count(*) filter (where r.removed_at is null)::int as recipients, count(*) filter (where r.removed_at is null and r.seen_at is not null)::int as seen,
        count(a.id) filter (where r.removed_at is null)::int as answered from announcement_recipients r left join announcement_responses a on a.recipient_id = r.id where r.announcement_id = ${n.id}::uuid`))] as NonNullable<NoticeView["stats"]>[];
      return {
        notice, category: cat ? { id: cat.id, name: cat.name, tone: cat.tone } : null, authorName: n.createdBy ? name.get(n.createdBy) ?? null : null, approvedByName: n.approvedBy ? name.get(n.approvedBy) ?? null : null,
        files: files.map((f) => ({ id: f.id, name: f.fileName, size: f.size, contentType: f.contentType, sort: f.sort })),
        versions: versions.map(({ v, by }) => ({ version: v.version, note: v.note, changedByName: by, at: v.createdAt, snapshot: v.snapshot })),
        review: n.reviewNote ? n.reviewNote.startsWith(REJECTED) ? { kind: "rejected", note: n.reviewNote.slice(REJECTED.length) } : { kind: "changes", note: n.reviewNote } : null,
        approvers: approvers.filter((a) => a.id !== n.createdBy).map((a) => a.name),
        audienceText: unsent ? (n.audience.include.length ? await describeAudience(tx, n.audience) : n.audienceLabel) : n.audienceLabel,
        preview: unsent && n.audience.include.length ? await audiencePreview(tx, n.audience) : null,
        stats: stats ?? null, can: this.canOf(n, approvers, reach),
      };
    });
  }

  private canOf(n: Notice, approvers: { id: string }[], reach: "free" | "approval" | null): NoticeCan {
    const me = this.ctx.userId, owns = n.createdBy === me || this.isManager, st = n.state, support = this.inSupport;
    const only = approvers.length === 1 && approvers[0]!.id === me;
    const mayApprove = this.can("approve") && st === "waiting" && (n.createdBy !== me || only);
    const sendable = owns && this.can("publish") && reach === "free";
    return {
      edit: owns && st === "draft" && this.can("draft"), submit: owns && canDo(st, "submit") && this.can("draft"), recall: owns && canDo(st, "recall"),
      publish: sendable && canDo(st, "publish") && (n.type !== "urgent" || this.can("urgent")), schedule: sendable && canDo(st, "schedule") && n.type !== "urgent",
      unschedule: owns && canDo(st, "unschedule"), sendNow: sendable && canDo(st, "sendNow"),
      undo: owns && canDo(st, "undo") && n.type !== "urgent" && !!n.sendAt && n.sendAt.getTime() > Date.now(),
      approve: mayApprove, approveNeedsReason: mayApprove && n.createdBy === me, askChanges: mayApprove && n.createdBy !== me, reject: mayApprove && n.createdBy !== me,
      correct: owns && canDo(st, "correct") && this.can("draft"), withdraw: owns && canDo(st, "withdraw"), delete: owns && canDo(st, "delete"),
      duplicate: this.can("draft") && !support, report: owns && !support && ["sending", "published", "expired", "withdrawn"].includes(st),
      website: this.websiteAllowed(), urgent: this.can("urgent"),
    };
  }

  private websiteAllowed() { return this.isManager || this.can("approve"); }

  // ---------- writing ----------

  /** Merge input into content and apply the rules that hold at every save. */
  private async shape(tx: Tx, base: NoticeContent, d: DraftInput): Promise<NoticeContent> {
    const c: NoticeContent = { ...base };
    for (const k of CONTENT_KEYS) if (d[k] !== undefined) (c as unknown as Record<string, unknown>)[k] = d[k];
    if (d.websiteOnly === true) { c.audience = NO_AUDIENCE; c.website = true; }
    if (d.websiteOnly === false && !c.audience.include.length) c.website = false;
    if (c.type === "urgent") {
      if (!this.can("urgent")) throw new ForbiddenError("Only an admin can send an urgent alert.");
      if (c.response.kind === "none") c.response = { kind: "ack" };
    }
    if (c.categoryId) {
      const [cat] = await tx.select({ name: announcementCategories.name }).from(announcementCategories).where(eq(announcementCategories.id, c.categoryId));
      if (!cat) this.fieldError("categoryId", "Choose a category from the list");
      if (c.type === "urgent" && cat.name.toLowerCase() === "fees") this.fieldError("type", "An urgent alert cannot be about fees");
    }
    if (c.website) {
      const asked = d.website === true || d.websiteOnly === true;
      if (!publicAudience(c.audience) || !this.websiteAllowed()) {
        if (asked) this.fieldError("website", this.websiteAllowed() ? "Only a notice for everyone can go on the website" : "Only an admin or an approver can put a notice on the website");
        c.website = false;
      }
    }
    if (c.audience.include.length) await this.reach(tx, c.audience, "draft");
    return c;
  }

  private async problems(tx: Tx, c: NoticeContent) {
    const [cat] = c.categoryId ? await tx.select({ name: announcementCategories.name }).from(announcementCategories).where(eq(announcementCategories.id, c.categoryId)) : [];
    const e = readyErrors(c, { languages: (await this.settings(tx)).languages, categoryName: cat?.name ?? null });
    if (Object.keys(e).length) throw new ValidationError(e);
  }

  private values(c: NoticeContent, label: string) { return { ...c, audienceLabel: label, updatedAt: new Date() }; }

  /** Save as the person types. Everything is optional. Creates the draft the first time (no id). */
  async saveDraft(input: unknown): Promise<{ id: string; updatedAt: Date }> {
    this.staffOnly();
    this.authorize("draft", "write");
    const d = this.parse(draftInput, input);
    return this.write("draft", async (tx) => {
      const old = d.id ? await this.find(tx, d.id, true) : null;
      if (old) { this.own(old); transition(old.state, "edit"); }
      const c = await this.shape(tx, old ? contentOf(old) : EMPTY, d);
      const label = await labelOf(tx, c);
      if (old) {
        const [row] = await tx.update(announcements).set(this.values(c, label)).where(eq(announcements.id, old.id)).returning({ id: announcements.id, updatedAt: announcements.updatedAt });
        return row!;
      }
      const [row] = await tx.insert(announcements).values({ ...this.values(c, label), schoolId: this.ctx.schoolId, createdBy: this.ctx.userId, state: "draft" }).returning({ id: announcements.id, updatedAt: announcements.updatedAt });
      await this.audit(tx, { action: "create", entity: "Notice", entityId: row!.id, summary: `Started a notice${c.title ? ` "${c.title}"` : ""}` });
      return row!;
    });
  }

  /** Send to the approvers. */
  async submit(id: string): Promise<{ id: string; state: NoticeState; approvers: string[] }> {
    this.staffOnly();
    return this.write("draft", async (tx) => {
      const n = await this.find(tx, id, true);
      this.own(n);
      transition(n.state, "submit");
      await this.problems(tx, contentOf(n));
      await this.reach(tx, n.audience, "draft");
      const people = (await this.approvers(tx)).filter((a) => a.id !== this.ctx.userId);
      if (!people.length) throw new ConflictError("No one is set up to approve notices. Ask an admin, or an admin can approve their own.");
      await tx.update(announcements).set({ state: "waiting", submittedAt: new Date(), reviewNote: null, updatedAt: new Date() }).where(eq(announcements.id, n.id));
      await NotificationWriter.insert(tx, this.ctx.schoolId, people.map((a) => ({
        userId: a.id, topic: "notice.approval" as const, title: `Notice waiting for approval: ${n.title}`, body: `From ${this.ctx.name}`, href: `/app/announcements/${n.id}`, subject: { type: "notice-approval", id: n.id }, action: true,
      })));
      await this.audit(tx, { action: "submit", entity: "Notice", entityId: n.id, summary: `Sent "${n.title}" for approval` });
      return { id: n.id, state: "waiting" as const, approvers: people.map((a) => a.name) };
    });
  }

  /** The writer takes a notice back from the approvers. */
  async recall(id: string) { return this.back(id, "recall", "Took back", null); }
  async askChanges(input: unknown) { const d = this.parse(noteInput, input); return this.back(d.id, "askChanges", "Asked for changes to", d.note); }
  async reject(input: unknown) { const d = this.parse(reasonInput, input); return this.back(d.id, "reject", "Rejected", `${REJECTED}${d.reason}`); }

  private async back(id: string, action: "recall" | "askChanges" | "reject", verb: string, note: string | null): Promise<{ id: string; state: NoticeState }> {
    this.staffOnly();
    return this.write(action === "recall" ? "draft" : "approve", async (tx) => {
      const n = await this.find(tx, id, true);
      if (action === "recall") this.own(n); else if (n.createdBy === this.ctx.userId) throw new ForbiddenError("You cannot review your own notice. Take it back instead.");
      transition(n.state, action);
      await tx.update(announcements).set({ state: "draft", reviewNote: note, submittedAt: null, updatedAt: new Date() }).where(eq(announcements.id, n.id));
      await NotificationWriter.done(tx, this.ctx.schoolId, { type: "notice-approval", id: n.id });
      if (action !== "recall" && n.createdBy) {
        await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: n.createdBy, topic: "work.update", title: `${verb} your notice: ${n.title}`, body: note?.replace(REJECTED, "") ?? undefined, href: `/app/announcements/${n.id}` }]);
      }
      await this.audit(tx, { action, entity: "Notice", entityId: n.id, summary: `${verb} "${n.title}"` });
      return { id: n.id, state: "draft" as const };
    });
  }

  /** Approve, optionally with edits (the author's wording is kept as a version). The author approves their own only when no one else can. */
  async approve(input: unknown): Promise<{ id: string; state: NoticeState; number: string | null }> {
    this.staffOnly();
    const d = this.parse(approveInput, input);
    const out = await this.write("approve", async (tx) => {
      const n = await this.find(tx, d.id, true);
      const me = this.ctx.userId;
      if (n.createdBy === me) {
        const people = await this.approvers(tx);
        if (!(people.length === 1 && people[0]!.id === me)) throw new ForbiddenError("You cannot approve your own notice. Another approver must.");
        if (!d.reason || d.reason.length < 3) this.fieldError("reason", "Say why you are approving your own notice");
      }
      const now = new Date();
      const later = !!n.scheduledAt && n.scheduledAt > now;
      const next = transition(n.state, later ? "approveScheduled" : "approve");
      let cur = n;
      if (d.edits && Object.keys(d.edits).length) {
        const c = await this.shape(tx, contentOf(n), d.edits);
        await tx.insert(announcementVersions).values({ schoolId: this.ctx.schoolId, announcementId: n.id, version: n.version, snapshot: snapshotOf(n), note: "As sent for approval", changedBy: n.createdBy });
        cur = (await tx.update(announcements).set({ ...this.values(c, await labelOf(tx, c)), version: n.version + 1 }).where(eq(announcements.id, n.id)).returning())[0]!;
      }
      await this.problems(tx, contentOf(cur));
      const [approved] = await tx.update(announcements).set({ approvedBy: me, approvalReason: d.reason ?? null, reviewNote: null }).where(eq(announcements.id, n.id)).returning();
      const row = next === "sending" ? await startSending(tx, this.ctx.schoolId, approved!, { immediate: false }) : (await tx.update(announcements).set({ state: "scheduled" }).where(eq(announcements.id, n.id)).returning())[0]!;
      await NotificationWriter.done(tx, this.ctx.schoolId, { type: "notice-approval", id: n.id });
      if (n.createdBy && n.createdBy !== me) {
        await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: n.createdBy, topic: "work.update", title: `Approved: ${n.title}`, body: d.edits ? "The approver made some changes." : undefined, href: `/app/announcements/${n.id}` }]);
      }
      await this.audit(tx, { action: "approve", entity: "Notice", entityId: n.id, summary: `Approved "${n.title}"${n.createdBy === me ? ` (own notice: ${d.reason})` : ""}` });
      return row;
    });
    return { id: out.id, state: out.state, number: out.number };
  }

  /** Send now, with the 30 seconds to undo. An urgent alert goes at once and must be confirmed (the count is in the message). */
  async publish(id: string, o: { confirmed?: boolean } = {}): Promise<{ id: string; state: NoticeState; number: string | null; sendAt: Date | null }> {
    this.staffOnly();
    const row = await this.write("publish", async (tx) => {
      const n = await this.find(tx, id, true);
      this.own(n);
      transition(n.state, "publish");
      await this.problems(tx, contentOf(n));
      if (n.type === "urgent") {
        if (!this.can("urgent")) throw new ForbiddenError("Only an admin can send an urgent alert.");
        if (!o.confirmed) {
          const say = `This reaches ${(await audiencePreview(tx, n.audience)).total} people at once and cannot be undone. Confirm to send.`;
          throw new ValidationError({ confirm: say }, say);
        }
      }
      if (n.audience.include.length && (await this.reach(tx, n.audience, "publish")) === "approval") throw new ConflictError("This reaches beyond your own classes, so it needs approval. Send it for approval.");
      const sending = await startSending(tx, this.ctx.schoolId, n, { immediate: n.type === "urgent" });
      await this.audit(tx, { action: "publish", entity: "Notice", entityId: n.id, summary: `Published "${n.title}"${sending.number ? ` as ${sending.number}` : ""}` });
      return sending;
    });
    if (row.type === "urgent") await fanOut(this.ctx.schoolId, row.id);
    return { id: row.id, state: row.type === "urgent" ? "published" : row.state, number: row.number, sendAt: row.sendAt };
  }

  /** Put it on a day and time. Says when that falls in quiet hours (people get the push at the end of them). */
  async schedule(id: string, at: Date | string): Promise<{ id: string; scheduledAt: Date; quietUntil: Date | null }> {
    this.staffOnly();
    const when = new Date(at);
    return this.write("publish", async (tx) => {
      const n = await this.find(tx, id, true);
      this.own(n);
      transition(n.state, "schedule");
      if (n.type === "urgent") throw new ConflictError("An urgent alert goes at once; it cannot be scheduled.");
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) this.fieldError("scheduledAt", "Choose a time that has not passed");
      await this.problems(tx, { ...contentOf(n), scheduledAt: when });
      if (n.audience.include.length && (await this.reach(tx, n.audience, "publish")) === "approval") throw new ConflictError("This reaches beyond your own classes, so it needs approval. Send it for approval.");
      await tx.update(announcements).set({ state: "scheduled", scheduledAt: when, updatedAt: new Date() }).where(eq(announcements.id, n.id));
      const s = await this.settings(tx);
      await this.audit(tx, { action: "schedule", entity: "Notice", entityId: n.id, summary: `Scheduled "${n.title}"` });
      return { id: n.id, scheduledAt: when, quietUntil: quietUntil(when, { from: s.quietFrom, to: s.quietTo, sundays: s.quietSundays }) };
    });
  }

  async unschedule(id: string): Promise<{ id: string }> {
    this.staffOnly();
    return this.write("publish", async (tx) => {
      const n = await this.find(tx, id, true);
      this.own(n);
      transition(n.state, "unschedule");
      await tx.update(announcements).set({ state: "draft", updatedAt: new Date() }).where(eq(announcements.id, n.id));
      await this.audit(tx, { action: "unschedule", entity: "Notice", entityId: n.id, summary: `Took "${n.title}" off the schedule` });
      return { id: n.id };
    });
  }

  /** While the 30 seconds last, nothing has left yet: back to a draft. */
  async undo(id: string): Promise<{ id: string }> {
    this.staffOnly();
    return this.write("publish", async (tx) => {
      const n = await this.find(tx, id, true);
      this.own(n);
      transition(n.state, "undo");
      if (n.type === "urgent" || !n.sendAt || n.sendAt <= new Date() || n.fannedOutAt) throw new ConflictError("It is already on its way and cannot be undone. You can withdraw it.");
      await tx.update(announcements).set({ state: "draft", sendAt: null, publishedAt: null, updatedAt: new Date() }).where(eq(announcements.id, n.id));
      await this.audit(tx, { action: "undo", entity: "Notice", entityId: n.id, summary: `Undid sending "${n.title}"` });
      return { id: n.id };
    });
  }

  /** A scheduled notice goes now. */
  async sendNow(id: string): Promise<{ id: string; number: string | null }> {
    this.staffOnly();
    const row = await this.write("publish", async (tx) => {
      const n = await this.find(tx, id, true);
      this.own(n);
      transition(n.state, "sendNow");
      const sending = await startSending(tx, this.ctx.schoolId, n, { immediate: true });
      await this.audit(tx, { action: "publish", entity: "Notice", entityId: n.id, summary: `Sent scheduled notice "${n.title}" now` });
      return sending;
    });
    await fanOut(this.ctx.schoolId, row.id);
    return { id: row.id, number: row.number };
  }

  /** A new version of a sent notice. People added get it; people removed lose it with a note; `notifyAgain` tells everyone else too. */
  async correct(input: unknown, o: { notifyAgain?: boolean } = {}): Promise<{ id: string; version: number; added: number; removed: number }> {
    this.staffOnly();
    const d = this.parse(correctInput, input);
    return this.write("draft", async (tx) => {
      const n = await this.find(tx, d.id, true);
      this.own(n);
      transition(n.state, "correct");
      const c = await this.shape(tx, contentOf(n), d.edits);
      if (!sameJson(c.response, n.response)) {
        const [answered] = await tx.select({ n: count() }).from(announcementResponses).innerJoin(announcementRecipients, eq(announcementRecipients.id, announcementResponses.recipientId)).where(eq(announcementRecipients.announcementId, n.id));
        if (Number(answered?.n ?? 0) > 0) this.fieldError("response", "People have already answered, so what you ask them cannot change. Withdraw and send a new notice instead.");
      }
      await this.problems(tx, c);
      const now = new Date();
      await tx.insert(announcementVersions).values({ schoolId: this.ctx.schoolId, announcementId: n.id, version: n.version, snapshot: snapshotOf(n), note: d.note ?? null, changedBy: this.ctx.userId });
      const [row] = await tx.update(announcements).set({ ...this.values(c, await labelOf(tx, c)), version: n.version + 1, correctedAt: now }).where(eq(announcements.id, n.id)).returning();
      let moved = { added: 0, removed: 0 };
      if (!sameJson(c.audience, n.audience)) moved = await reconcile(tx, this.ctx.schoolId, row!, { notifyAgain: !!o.notifyAgain, now });
      else {
        await NotificationWriter.rewrite(tx, this.ctx.schoolId, subjectOf(n.id), { title: row!.title, body: plain(row!) });
        if (o.notifyAgain) {
          const people = await tx.select({ u: announcementRecipients.userId }).from(announcementRecipients).where(and(eq(announcementRecipients.announcementId, n.id), sql`${announcementRecipients.removedAt} is null`));
          await tell(tx, this.ctx.schoolId, row!, people.flatMap((p) => (p.u && p.u !== n.createdBy ? [p.u] : [])), "changed");
        }
      }
      await this.audit(tx, { action: "correct", entity: "Notice", entityId: n.id, summary: `Corrected "${n.title}" (version ${row!.version})${o.notifyAgain ? ", told everyone again" : ""}` });
      return { id: n.id, version: row!.version, ...moved };
    });
  }

  /** People see "Withdrawn by the school" and the reason; the text is hidden and the bell row says so. */
  async withdraw(id: string, reason: string): Promise<{ id: string }> {
    this.staffOnly();
    const d = this.parse(reasonInput, { id, reason });
    return this.write("draft", async (tx) => {
      const n = await this.find(tx, d.id, true);
      this.own(n);
      transition(n.state, "withdraw");
      const now = new Date();
      await tx.update(announcements).set({ state: "withdrawn", withdrawnAt: now, withdrawnBy: this.ctx.userId, withdrawReason: d.reason, updatedAt: now }).where(eq(announcements.id, n.id));
      await NotificationWriter.rewrite(tx, this.ctx.schoolId, subjectOf(n.id), { title: "Withdrawn by the school", body: d.reason });
      await NotificationWriter.done(tx, this.ctx.schoolId, subjectOf(n.id));
      await this.audit(tx, { action: "withdraw", entity: "Notice", entityId: n.id, summary: `Withdrew "${n.title}": ${d.reason}` });
      return { id: n.id };
    });
  }

  /** A new draft with the same words, audience and question. Dates, the website flag and the number start fresh. */
  async duplicate(id: string): Promise<{ id: string }> {
    this.staffOnly();
    this.noSupport();
    return this.write("draft", async (tx) => {
      const n = await this.find(tx, id);
      const c: NoticeContent = { ...contentOf(n), dueAt: null, scheduledAt: null, expiresAt: null, pinnedUntil: null, website: false };
      const [row] = await tx.insert(announcements).values({ ...this.values(c, n.audienceLabel), schoolId: this.ctx.schoolId, createdBy: this.ctx.userId, state: "draft" }).returning({ id: announcements.id });
      const files = await tx.select().from(announcementFiles).where(eq(announcementFiles.announcementId, n.id));
      if (files.length) await tx.insert(announcementFiles).values(files.map((f) => ({ schoolId: this.ctx.schoolId, announcementId: row!.id, fileKey: f.fileKey, fileName: f.fileName, contentType: f.contentType, size: f.size, sort: f.sort })));
      await this.audit(tx, { action: "create", entity: "Notice", entityId: row!.id, summary: `Copied "${n.title}" to a new draft` });
      return row!;
    });
  }

  /** Only a draft can be deleted; anything that has been sent is withdrawn instead. */
  async deleteDraft(id: string): Promise<{ id: string }> {
    this.staffOnly();
    const gone = await this.write("draft", async (tx) => {
      const n = await this.find(tx, id, true);
      this.own(n);
      transition(n.state, "delete");
      const keys = (await tx.select({ k: announcementFiles.fileKey }).from(announcementFiles).where(eq(announcementFiles.announcementId, n.id))).map((f) => f.k);
      await tx.delete(announcementVersions).where(eq(announcementVersions.announcementId, n.id));
      await tx.delete(announcements).where(eq(announcements.id, n.id));
      await this.audit(tx, { action: "delete", entity: "Notice", entityId: n.id, summary: `Deleted draft "${n.title}"` });
      return keys;
    });
    await FileBin.dropUnused(this.ctx.schoolId, gone);
    return { id };
  }
}
