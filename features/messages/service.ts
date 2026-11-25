import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { ForbiddenError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { notificationPrefs } from "@smw/feature-notifications/schema";
import { loadCommSettings, type CommSettings } from "@smw/feature-notifications/settings";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { REMOVE_MINUTES, PAGE_SIZE, type ReportCategory, type ReportState, type ThreadKind } from "./constants";
import { Starters, type Contact, type StudentContact } from "./contact-rules";
import {
  activeRestriction, addMember, canOpenThread, createThread, isFamily, istToday, loadThread, markThreadRead, noSupport, postMessage, postSystem, removeStored, requireMember,
  signedLink, storeFiles, unreadByThread, type Message, type StoredFile, type ThreadData, type UploadedFile,
} from "./core";
import { conversationPdf } from "./conversation-pdf";
import messagesFeature from "./feature";
import { LINK_SECONDS } from "./constants";
import { reportInput, savedReplyInput, sendInput, startInput } from "./inputs";
import { isNamed, leadIds } from "./leads";
import { students } from "@smw/feature-students/schema";
import { messageFiles, messageReports, messages, messageThreads, savedReplies, threadMembers } from "./schema";

type Perm = keyof typeof messagesFeature.permissions;
export type { Contact, Message, StudentContact, ThreadData };

export interface Person { id: string | null; name: string; role: string }
export interface InboxThread {
  id: string; subject: string; kind: ThreadKind; state: "open" | "closed"; studentName: string | null; lastMessageAt: Date;
  /** Everyone in the conversation except the caller. */
  people: Person[]; unread: number; preview: string; lastSenderName: string | null; pinned: boolean; muted: boolean; archived: boolean; held: boolean;
}
export interface InboxQuery { view?: "all" | "unread" | "archived"; studentId?: string; q?: string; cursor?: string | null }
export interface InboxPage {
  rows: InboxThread[];
  /** Pass as `cursor` for the next page; null on the last. */
  next: string | null;
  /** Everything unread across the caller's conversations (the sidebar badge). */
  unread: number;
}
export type ComposerBlock = { reason: string; action?: { label: string; href: string } };
export interface ThreadView extends ThreadData {
  /** Why the box is closed, or null when the caller can write. */
  block: ComposerBlock | null;
  /** A line under the box: when the others will be told, who is away. */
  notice: string | null;
  /** Show "The school can review this conversation". */
  reviewBanner: boolean;
  /** The caller has not written here yet: show the banner in the composer area too. */
  firstWrite: boolean;
}
export interface MyReport { id: string; subject: string; category: ReportCategory; state: ReportState; createdAt: Date }
export interface SavedReply { id: string; title: string; body: string; shared: boolean }

const like = (q?: string) => (q?.trim() ? `%${q.trim().slice(0, 100).replace(/[\\%_]/g, "\\$&")}%` : null);
const clock = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const dayWords = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/**
 * Conversations of one person. Every read and write goes through core.ts, which only lets members in.
 * Who may START one is decided by Starters (contact-rules.ts); the school's switches come from comm settings.
 */
export class MessageService extends SchoolService<Perm> {
  protected feature = messagesFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Triakshi support works inside a school's account but never inside its private conversations. */
  protected authorize(permission: Perm, mode: "read" | "write") {
    noSupport(this.ctx);
    super.authorize(permission, mode);
  }

  private get family() { return isFamily(this.ctx.role); }

  // ---------- inbox ----------

  /** One page of the caller's conversations: pinned first (first page only), then newest activity. Keyset paging, so any number of conversations can be reached. */
  async inbox(query: InboxQuery = {}): Promise<InboxPage> {
    return this.read("use", async (tx) => {
      const view = query.view ?? "all";
      const unread = await unreadByThread(tx, this.ctx);
      const total = [...unread.values()].reduce((a, b) => a + b, 0);
      if (view === "unread" && !unread.size) return { rows: [], next: null, unread: 0 };
      const t = like(query.q);
      const cursor = query.cursor?.split("|");
      const mineWhere = and(
        eq(threadMembers.userId, this.ctx.userId), eq(threadMembers.state, "active"), eq(threadMembers.archived, view === "archived"),
        query.studentId ? eq(messageThreads.studentId, query.studentId) : undefined,
        view === "unread" ? inArray(messageThreads.id, [...unread.keys()]) : undefined,
        t ? or(ilike(messageThreads.subject, t), sql`exists (select 1 from messages x where x.thread_id = ${messageThreads.id} and x.removed_at is null and x.body ilike ${t}${this.family ? sql` and x.internal = false` : sql``})`) : undefined,
      );
      const rows = (pinned: boolean) => tx.select({ t: messageThreads, m: threadMembers, cur: sql<string>`${messageThreads.lastMessageAt}::text` }).from(threadMembers)
        .innerJoin(messageThreads, eq(messageThreads.id, threadMembers.threadId))
        .where(and(mineWhere, eq(threadMembers.pinned, pinned),
          !pinned && cursor ? sql`(${messageThreads.lastMessageAt}, ${messageThreads.id}) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)` : undefined))
        .orderBy(desc(messageThreads.lastMessageAt), desc(messageThreads.id)).limit(pinned ? 50 : PAGE_SIZE + 1);
      const [pins, list] = await Promise.all([cursor ? Promise.resolve([]) : rows(true), rows(false)]);
      const more = list.length > PAGE_SIZE;
      const page = [...pins, ...list.slice(0, PAGE_SIZE)];
      const last = list[PAGE_SIZE - 1];
      return { rows: await this.describe(tx, page, unread), next: more && last ? `${last.cur}|${last.t.id}` : null, unread: total };
    });
  }

  private async describe(tx: Tx, page: { t: typeof messageThreads.$inferSelect; m: typeof threadMembers.$inferSelect }[], unread: Map<string, number>): Promise<InboxThread[]> {
    const ids = page.map((p) => p.t.id);
    if (!ids.length) return [];
    const studentIds = [...new Set(page.map((p) => p.t.studentId).filter((s): s is string => !!s))];
    const [people, last, kids] = await Promise.all([
      tx.select({ threadId: threadMembers.threadId, id: threadMembers.userId, name: threadMembers.name, role: threadMembers.role }).from(threadMembers)
        .where(and(inArray(threadMembers.threadId, ids), eq(threadMembers.state, "active"), ne(threadMembers.userId, this.ctx.userId))).orderBy(asc(threadMembers.name)),
      tx.selectDistinctOn([messages.threadId], { threadId: messages.threadId, body: messages.body, senderId: messages.senderId, senderName: messages.senderName, removed: messages.removedAt, kind: messages.kind })
        .from(messages).where(and(inArray(messages.threadId, ids), this.family ? eq(messages.internal, false) : undefined)).orderBy(messages.threadId, desc(messages.createdAt)),
      studentIds.length ? tx.select({ id: students.id, name: students.name }).from(students).where(inArray(students.id, studentIds)) : Promise.resolve([] as { id: string; name: string }[]),
    ]);
    return page.map(({ t, m }) => {
      const l = last.find((x) => x.threadId === t.id);
      return {
        id: t.id, subject: t.subject, kind: t.kind, state: t.state, studentName: kids.find((k) => k.id === t.studentId)?.name ?? null, lastMessageAt: t.lastMessageAt,
        people: people.filter((p) => p.threadId === t.id).map(({ id, name, role }) => ({ id, name, role })), unread: unread.get(t.id) ?? 0,
        preview: l ? (l.removed ? "Message removed" : l.body) : "", lastSenderName: l ? (l.kind === "system" ? null : l.senderId === this.ctx.userId ? "You" : l.senderName) : null,
        pinned: m.pinned, muted: m.muted, archived: m.archived, held: !!t.heldAt,
      };
    });
  }

  /** Students my conversations are about, for the "by student" filter. */
  async inboxStudents(): Promise<{ id: string; name: string }[]> {
    return this.read("use", (tx) => tx.selectDistinct({ id: students.id, name: students.name }).from(threadMembers)
      .innerJoin(messageThreads, eq(messageThreads.id, threadMembers.threadId)).innerJoin(students, eq(students.id, messageThreads.studentId))
      .where(and(eq(threadMembers.userId, this.ctx.userId), eq(threadMembers.state, "active"))).orderBy(asc(students.name)).limit(200));
  }

  /** Total unread across the caller's conversations (the sidebar badge): the same numbers the inbox shows. */
  async unreadCount(): Promise<number> {
    return this.read("use", async (tx) => [...(await unreadByThread(tx, this.ctx)).values()].reduce((a, b) => a + b, 0));
  }

  // ---------- one conversation ----------

  /** One conversation, newest messages last. Opening it marks exactly the messages shown as read, and clears its bell row and pending push and email. */
  async thread(id: string, o: { before?: string | null } = {}): Promise<ThreadView> {
    const load = async (tx: Tx) => {
      const data = await loadThread(tx, id, this.ctx, o);
      return this.view(tx, data);
    };
    // A read-only school can still read its messages; it just cannot record that it did.
    if (this.ctx.readOnly) return this.read("use", load);
    return this.write("use", async (tx) => {
      const v = await load(tx);
      if (!o.before) await markThreadRead(tx, this.ctx, id, v.newestAt);
      return v;
    });
  }

  private async view(tx: Tx, data: ThreadData): Promise<ThreadView> {
    const settings = await loadCommSettings(tx);
    const others = data.members.filter((m) => !m.mine && m.state === "active");
    let block: ComposerBlock | null = null;
    const t = data.thread;
    if (this.ctx.readOnly) block = { reason: "Your school is read-only, so messages cannot be sent. Renew the plan in Billing." };
    else if (t.kind === "legacy") block = { reason: "This is an old group conversation, so it is read only. Start a new message to write to one family." };
    else if (t.state === "closed") block = { reason: `This conversation is closed${t.closedReason ? `: ${t.closedReason}` : ""}.`, ...(this.can("manage") ? { action: { label: "Move to a new teacher", href: `/app/messages?thread=${t.id}&move=1` } } : {}) };
    else if (this.family && t.kind === "student" && !settings.familiesMayReply) block = { reason: "The school has turned off replies from families. Please contact the school office." };
    else if ((await activeRestriction(tx, this.ctx.userId))?.kind === "blocked") block = { reason: "The school has switched off your messages for now. Please contact the school office." };
    else if (others.length && !others.some((m) => m.canReceive)) block = { reason: `This cannot be delivered: ${others.map((m) => m.name).join(", ")} can no longer sign in. Contact the school office.` };
    const away = others.filter((m) => m.away).map((m) => `${m.name} is away until ${dayWords(new Date(`${m.away!.until}T00:00:00+05:30`))}${m.away!.text ? `: ${m.away!.text}` : "."}`);
    const wait = data.holdUntil ? `Will be delivered at ${clock(data.holdUntil)}${data.holdUntil.getTime() - Date.now() > 86_400_000 ? `, ${dayWords(data.holdUntil)}` : ""}. They can read it in the app now.` : null;
    return {
      ...data, block, notice: [wait, ...away].filter(Boolean).join(" ") || null,
      reviewBanner: t.kind === "student" || t.kind === "request",
      firstWrite: !data.messages.some((m) => m.mine && m.kind === "text"),
    };
  }

  // ---------- writing ----------

  /** Reply inside a conversation the caller is in. Files are stored only after the caller is known to be a member. */
  async send(threadId: string, body: unknown, opts: { clientId?: string; files?: UploadedFile[] } = {}): Promise<Message> {
    this.authorize("use", "write");
    const data = this.parse(sendInput, { threadId, body, clientId: opts.clientId });
    return this.write("use", async (tx) => {
      const stored = await this.keep(tx, data.threadId, opts.files);
      try {
        const msg = await postMessage(tx, this.ctx, { threadId: data.threadId, body: data.body, clientId: data.clientId, files: stored });
        await this.dropUnused(tx, stored);
        return msg;
      } catch (e) { await removeStored(stored.map((s) => s.fileKey)); throw e; }
    });
  }

  private async keep(tx: Tx, threadId: string, files?: UploadedFile[]): Promise<StoredFile[]> {
    if (!files?.length) return [];
    await requireMember(tx, this.ctx, threadId);
    return storeFiles(this.ctx.schoolId, threadId, files);
  }

  /** A retry that matched an earlier message stores nothing new: delete the copies it uploaded. */
  private async dropUnused(tx: Tx, stored: StoredFile[]) {
    if (!stored.length) return;
    const used = new Set((await tx.select({ k: messageFiles.fileKey }).from(messageFiles).where(inArray(messageFiles.fileKey, stored.map((s) => s.fileKey)))).map((r) => r.k));
    await removeStored(stored.filter((s) => !used.has(s.fileKey)).map((s) => s.fileKey));
  }

  /**
   * Start a conversation. A family writes to a teacher or the office about one of their children. Staff pick the STUDENT, never a login:
   * the family is reached through that student. Without a student, it is a staff conversation. The first message is sent in the same step.
   */
  async start(input: unknown, files?: UploadedFile[]): Promise<{ id: string }> {
    this.authorize("use", "write");
    const data = this.parse(startInput, input);
    const recipients = [...new Set(data.recipientIds)].filter((id) => id !== this.ctx.userId);
    return this.write("use", async (tx) => {
      // A double press of Send carries one client id: the second finds the conversation the first made.
      if (data.clientId) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`start:${this.ctx.userId}:${data.clientId}`}, 0))`);
        const [dup] = await tx.select({ threadId: messages.threadId }).from(messages).where(and(eq(messages.senderId, this.ctx.userId), eq(messages.clientId, data.clientId)));
        if (dup) return { id: dup.threadId };
      }
      const settings = await loadCommSettings(tx);
      const rules = new Starters(this.ctx, settings);
      let kind: "student" | "staff" = "staff";
      let studentId: string | undefined;
      let members: { userId: string }[] = [];
      if (this.family) {
        if (!settings.familiesMayStart) throw new ForbiddenError("The school has turned off new conversations from families. Please contact the school office.");
        const kids = await rules.children(tx);
        studentId = data.studentId ?? (kids.length === 1 ? kids[0]!.id : undefined);
        if (!studentId || !kids.some((k) => k.id === studentId)) throw new ValidationError({ studentId: "Choose which child this is about" });
        if (!recipients.length) throw new ValidationError({ recipientIds: "Choose who to write to" });
        await this.allowed(tx, rules, recipients, studentId);
        kind = "student";
        members = recipients.map((userId) => ({ userId }));
      } else if (data.studentId) {
        const s = await rules.studentFor(tx, data.studentId);
        await this.allowed(tx, rules, recipients, undefined);
        kind = "student"; studentId = s.id;
        members = [{ userId: s.userId }, ...recipients.map((userId) => ({ userId }))];
      } else {
        if (!recipients.length) throw new ValidationError({ recipientIds: "Pick at least one person other than yourself" });
        await this.allowed(tx, rules, recipients, undefined);
        members = recipients.map((userId) => ({ userId }));
      }
      const thread = await createThread(tx, this.ctx, { kind, subject: data.subject, studentId, members });
      const stored = await this.keep(tx, thread.id, files);
      try { await postMessage(tx, this.ctx, { threadId: thread.id, body: data.body, clientId: data.clientId, files: stored }); }
      catch (e) { await removeStored(stored.map((s) => s.fileKey)); throw e; }
      return { id: thread.id };
    }, (r) => ({ action: "start", entity: "Conversation", entityId: r.id, summary: `Started conversation "${data.subject}"` }));
  }

  private async allowed(tx: Tx, rules: Starters, ids: string[], studentId?: string) {
    if (!ids.length) return;
    if ((await rules.allowedStaff(tx, ids, studentId)).size !== ids.length) throw new ForbiddenError("You cannot message one of these people.");
  }

  // ---------- who to pick ----------

  /** Staff to pick: a family sees the child's teachers by subject and the office; staff see colleagues. */
  async contacts(q?: string, studentId?: string): Promise<Contact[]> {
    return this.read("use", async (tx) => {
      const rules = new Starters(this.ctx, await loadCommSettings(tx));
      return this.family ? rules.teachers(tx, studentId) : rules.staff(tx, q);
    });
  }

  /** Staff only: students whose families the caller may write to. */
  async students(q?: string): Promise<StudentContact[]> {
    if (this.family) throw new ForbiddenError();
    return this.read("use", async (tx) => new Starters(this.ctx, await loadCommSettings(tx)).students(tx, q));
  }

  /** A family's own children. */
  async children(): Promise<{ id: string; name: string }[]> {
    return this.read("use", async (tx) => new Starters(this.ctx, await loadCommSettings(tx)).children(tx));
  }

  /** What the start screen needs to know about the switches: can this family start, and why not. */
  async startRules(): Promise<{ canStart: boolean; why: string | null; settings: Pick<CommSettings, "attachments" | "officeName"> }> {
    return this.read("use", async (tx) => {
      const s = await loadCommSettings(tx);
      const restricted = await activeRestriction(tx, this.ctx.userId);
      const why = this.ctx.readOnly ? "Your school is read-only, so new messages cannot be sent."
        : this.family && !s.familiesMayStart ? "The school has turned off new conversations from families. Contact the school office."
        : restricted ? `The school has limited your messages until ${dayWords(new Date(`${restricted.until}T00:00:00+05:30`))}. Contact the school office.` : null;
      return { canStart: !why, why, settings: { attachments: s.attachments, officeName: s.officeName } };
    });
  }

  // ---------- my marks on a conversation (they work in a read-only school too) ----------

  async mark(threadId: string, flag: "pinned" | "muted" | "archived", on: boolean): Promise<void> {
    await this.read("use", async (tx) => {
      const { member } = await requireMember(tx, this.ctx, threadId);
      await tx.update(threadMembers).set({ [flag]: on }).where(eq(threadMembers.id, member.id));
    });
  }

  /** Make the newest message from someone else unread again, so it stays in the badge until opened. */
  async markUnread(threadId: string): Promise<void> {
    await this.read("use", async (tx) => {
      const { member } = await requireMember(tx, this.ctx, threadId);
      await tx.update(threadMembers).set({
        lastReadAt: sql`(select max(${messages.createdAt}) - interval '1 microsecond' from ${messages} where ${messages.threadId} = ${threadId} and ${messages.senderId} is distinct from ${this.ctx.userId} and ${messages.kind} = 'text' and ${messages.removedAt} is null ${this.family ? sql`and ${messages.internal} = false` : sql``})`,
      }).where(eq(threadMembers.id, member.id));
    });
  }

  /** Remove my own message within 10 minutes. It shows "Message removed"; the original stays for safeguarding. A held conversation keeps everything. */
  async remove(messageId: string): Promise<void> {
    await this.write("use", async (tx) => {
      const [m] = await tx.select({ m: messages, held: messageThreads.heldAt }).from(messages).innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
        .where(eq(messages.id, messageId));
      if (!m) throw new NotFoundError("Message");
      await requireMember(tx, this.ctx, m.m.threadId);
      if (m.m.senderId !== this.ctx.userId || m.m.kind !== "text") throw new ForbiddenError("You can remove only your own messages.");
      if (m.m.removedAt) return;
      if (m.held) throw new ForbiddenError("This conversation is under review, so nothing in it can be removed.");
      if (Date.now() - m.m.createdAt.getTime() > REMOVE_MINUTES * 60_000) throw new ForbiddenError(`A message can be removed within ${REMOVE_MINUTES} minutes of sending it.`);
      await tx.update(messages).set({ removedAt: new Date(), removedBy: this.ctx.userId }).where(eq(messages.id, messageId));
    });
  }

  // ---------- concerns ----------

  /**
   * Report a concern about a message or a whole conversation. The people it is about (the sender of the message, or for a conversation the
   * other side, plus anyone the reporter names) never see it. The conversation is held: nothing in it can be removed or expire.
   * Returns how many leads were told; zero means the screen should show the outside contacts.
   */
  async report(input: unknown): Promise<{ id: string; told: number }> {
    this.authorize("use", "write");
    const data = this.parse(reportInput, input);
    return this.write("use", async (tx) => {
      const { thread, member } = await requireMember(tx, this.ctx, data.threadId);
      let about: string[] = [];
      if (data.messageId) {
        const [m] = await tx.select({ senderId: messages.senderId, internal: messages.internal }).from(messages).where(and(eq(messages.id, data.messageId), eq(messages.threadId, thread.id)));
        if (!m || (this.family && m.internal)) throw new NotFoundError("Message");
        if (m.senderId) about.push(m.senderId);
      } else {
        const rest = await tx.select({ id: threadMembers.userId }).from(threadMembers).where(and(eq(threadMembers.threadId, thread.id), ne(threadMembers.userId, this.ctx.userId)));
        about = rest.map((r) => r.id).filter((x): x is string => !!x);
      }
      if (data.aboutUserId) {
        const [p] = await tx.select({ id: threadMembers.userId }).from(threadMembers).where(and(eq(threadMembers.threadId, thread.id), eq(threadMembers.userId, data.aboutUserId)));
        if (!p) throw new ValidationError({ aboutUserId: "Choose someone in this conversation" });
        about.push(data.aboutUserId);
      }
      about = [...new Set(about.filter((a) => a !== this.ctx.userId))];
      const [row] = await tx.insert(messageReports).values({
        schoolId: this.ctx.schoolId, threadId: thread.id, messageId: data.messageId ?? null, category: data.category, note: data.note,
        reportedBy: this.ctx.userId, reporterName: member.name, aboutUserIds: about,
      }).returning();
      await tx.update(messageThreads).set({ heldAt: sql`coalesce(${messageThreads.heldAt}, now())` }).where(eq(messageThreads.id, thread.id));
      const leads = await leadIds(tx, [...about]);
      await NotificationWriter.insert(tx, this.ctx.schoolId, leads.filter((l) => l !== this.ctx.userId).map((userId) => ({
        userId, topic: "safety.report" as const, title: "A concern was reported", body: "Open Safeguarding to read it.", href: `/app/safeguarding/${row!.id}`,
        subject: { type: "report", id: row!.id }, action: true, privateBody: true,
      })));
      return { id: row!.id, told: leads.length };
    }, (r) => ({ action: "report", entity: "Conversation", entityId: data.threadId, summary: `Reported a concern (${r.told} lead${r.told === 1 ? "" : "s"} told)` }));
  }

  /** Concerns I reported, with where each stands. */
  async myReports(): Promise<MyReport[]> {
    return this.read("use", async (tx) => (await tx.select({ id: messageReports.id, subject: messageThreads.subject, category: messageReports.category, state: messageReports.state, createdAt: messageReports.createdAt })
      .from(messageReports).innerJoin(messageThreads, eq(messageThreads.id, messageReports.threadId))
      .where(eq(messageReports.reportedBy, this.ctx.userId)).orderBy(desc(messageReports.createdAt)).limit(50)) as MyReport[]);
  }

  // ---------- saved replies ----------

  /** Mine and the office's shared ones. Staff only. */
  async savedReplies(): Promise<SavedReply[]> {
    if (this.family) return [];
    return this.read("use", async (tx) => (await tx.select().from(savedReplies).where(or(isNull(savedReplies.userId), eq(savedReplies.userId, this.ctx.userId))).orderBy(asc(savedReplies.title)))
      .map((r) => ({ id: r.id, title: r.title, body: r.body, shared: r.userId === null })));
  }

  async saveReply(input: unknown): Promise<SavedReply> {
    this.authorize("use", "write");
    const data = this.parse(savedReplyInput, input);
    if (this.family) throw new ForbiddenError();
    if (data.shared && !this.can("all")) throw new ForbiddenError("Only the office can add a shared reply.");
    return this.write("use", async (tx) => {
      const [r] = await tx.insert(savedReplies).values({ schoolId: this.ctx.schoolId, title: data.title, body: data.body, userId: data.shared ? null : this.ctx.userId }).returning();
      return { id: r!.id, title: r!.title, body: r!.body, shared: data.shared };
    });
  }

  async deleteReply(id: string): Promise<void> {
    if (this.family) throw new ForbiddenError();
    await this.write("use", async (tx) => {
      const [r] = await tx.select().from(savedReplies).where(eq(savedReplies.id, id));
      if (!r || (r.userId ? r.userId !== this.ctx.userId : !this.can("all"))) throw new NotFoundError("Reply");
      await tx.delete(savedReplies).where(eq(savedReplies.id, id));
    });
  }

  // ---------- files and export ----------

  /** A 60 second link to one file, only for a member (or a reviewer with an open, logged review). Anyone else, and any other school, gets "not found". */
  async fileLink(fileId: string): Promise<{ url: string; name: string }> {
    return this.read("use", async (tx) => {
      const [f] = await tx.select({ f: messageFiles, threadId: messages.threadId, internal: messages.internal, removed: messages.removedAt }).from(messageFiles)
        .innerJoin(messages, eq(messages.id, messageFiles.messageId)).where(eq(messageFiles.id, fileId));
      if (!f || !(await canOpenThread(tx, this.ctx, f.threadId))) throw new NotFoundError("File");
      let member = true;
      try { await requireMember(tx, this.ctx, f.threadId); } catch { member = false; }
      if (member && ((this.family && f.internal) || f.removed)) throw new NotFoundError("File");
      return { url: await signedLink(f.f.fileKey, LINK_SECONDS), name: f.f.fileName };
    });
  }

  /** My own copy of a conversation I am in. */
  async exportPdf(threadId: string): Promise<{ name: string; bytes: Uint8Array }> {
    return this.read("use", async (tx) => {
      const data = await loadThread(tx, threadId, this.ctx, { limit: 5000 });
      if (data.thread.held && (await isNamed(tx, threadId, this.ctx.userId))) throw new ForbiddenError("This conversation is under review, so it cannot be exported.");
      const [school] = [...(await tx.execute(sql`select name from schools limit 1`))] as { name: string }[];
      return { name: `conversation-${threadId.slice(0, 8)}.pdf`, bytes: await conversationPdf(data, { school: school?.name ?? "School", exportedBy: this.ctx.name }) };
    });
  }

  // ---------- admin ----------

  /** A closed conversation (its teacher stopped teaching the student) moves to the new teacher and opens again. */
  async reassign(threadId: string, newTeacherId: string): Promise<void> {
    await this.write("manage", async (tx) => {
      const [t] = await tx.select().from(messageThreads).where(eq(messageThreads.id, threadId));
      if (!t || t.kind !== "student") throw new NotFoundError("Conversation");
      const [teacher] = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, newTeacherId), eq(users.role, "teacher"), eq(users.status, "active")));
      if (!teacher) throw new ValidationError({ teacherId: "Choose an active teacher" });
      await addMember(tx, this.ctx, threadId, { userId: teacher.id }, { trusted: true });
      await tx.update(threadMembers).set({ state: "left" }).where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.role, "teacher"), ne(threadMembers.userId, teacher.id)));
      await tx.update(messageThreads).set({ state: "open", closedReason: null }).where(eq(messageThreads.id, threadId));
      await postSystem(tx, this.ctx.schoolId, threadId, `${teacher.name} is now the teacher in this conversation.`);
    }, () => ({ action: "reassign", entity: "Conversation", entityId: threadId, summary: "Moved a conversation to another teacher" }));
  }

  /** Active teachers an admin may move a closed conversation to. */
  async teacherChoices(): Promise<{ id: string; name: string }[]> {
    return this.read("manage", (tx) => tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "teacher"), eq(users.status, "active"))).orderBy(asc(users.name)));
  }

  /** The other side's people who are away or in quiet hours matter to the composer, so the start screen can say so too. */
  async awayOf(userIds: string[]): Promise<{ id: string; until: string; text: string | null }[]> {
    if (!userIds.length) return [];
    return this.read("use", async (tx) => (await tx.select({ id: notificationPrefs.userId, until: notificationPrefs.awayUntil, text: notificationPrefs.awayText }).from(notificationPrefs)
      .where(and(inArray(notificationPrefs.userId, userIds), sql`${notificationPrefs.awayUntil} >= ${istToday()}::date`))).map((r) => ({ id: r.id, until: r.until!, text: r.text })));
  }
}
