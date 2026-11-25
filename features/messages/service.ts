import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { users, type Tx } from "@smw/db";
import { ForbiddenError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import messagesFeature from "./feature";
import { CONTACT_RULES, type Contact } from "./contact-rules";
import { sendInput, startInput } from "./inputs";
import { messages, messageThreads, threadMembers } from "./schema";

type Perm = keyof typeof messagesFeature.permissions;
export type Message = typeof messages.$inferSelect;
export type { Contact };

export interface Person { id: string; name: string; role: string }
export interface InboxThread {
  id: string; subject: string; kind: "direct" | "group"; lastMessageAt: Date;
  /** Everyone in the conversation except the caller. */
  people: Person[]; unread: number; preview: string; lastSenderName: string | null;
}
export interface ThreadView {
  id: string; subject: string; kind: "direct" | "group"; people: Person[];
  messages: { id: string; senderId: string | null; senderName: string; body: string; createdAt: Date }[];
}

const MAX_MESSAGES = 500;
const PEOPLE_CAP = 30;
const MAX_PER_MINUTE = 20;

/**
 * Private conversations inside one school. Every query goes through `thread_members`, so a conversation is
 * invisible to anyone who is not in it. Who may START a conversation with whom is decided by a ContactRule.
 */
export class MessageService extends SchoolService<Perm> {
  protected feature = messagesFeature;
  private readonly rule = CONTACT_RULES[this.ctx.role];

  constructor(ctx: Ctx) { super(ctx); }

  /** Triakshi support works inside a school's account but never inside its private conversations. */
  protected authorize(permission: Perm, mode: "read" | "write") {
    if (this.ctx.supportStaffId) throw new ForbiddenError("Private messages are not available in a support session.");
    super.authorize(permission, mode);
  }

  /** At most 20 messages a minute and 60 new conversations a day (10 for a family) from one person. */
  private async limit(tx: Tx, starting: boolean) {
    const [m] = await tx.select({ n: count() }).from(messages).where(and(eq(messages.senderId, this.ctx.userId), sql`${messages.createdAt} > now() - interval '1 minute'`));
    if (Number(m?.n) >= MAX_PER_MINUTE) throw new ValidationError({ body: "That is a lot of messages. Try again in a minute." });
    if (!starting) return;
    const [t] = await tx.select({ n: count() }).from(messageThreads).where(and(eq(messageThreads.createdBy, this.ctx.userId), sql`${messageThreads.createdAt} > now() - interval '1 day'`));
    if (Number(t?.n) >= (this.ctx.role === "student" ? 10 : 60)) throw new ValidationError({ body: "You have started many conversations today. Try again tomorrow." });
  }

  /** Throws NotFoundError (never Forbidden: do not reveal that a conversation exists) unless the caller is a member. */
  private async requireMember(tx: Tx, threadId: string) {
    const ok = z.uuid().safeParse(threadId).success &&
      (await tx.select({ id: threadMembers.id }).from(threadMembers).where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.userId, this.ctx.userId))).limit(1)).length > 0;
    if (!ok) throw new NotFoundError("Conversation");
  }

  /** Messages from others that the caller has not opened yet (needs the caller's membership row joined in). */
  private unread(threadIds?: string[]) {
    const me = this.ctx.userId;
    return and(sql`${messages.senderId} is distinct from ${me}`, or(isNull(threadMembers.lastReadAt), sql`${messages.createdAt} > ${threadMembers.lastReadAt}`), threadIds ? inArray(messages.threadId, threadIds) : undefined);
  }
  private mine() { return and(eq(threadMembers.threadId, messages.threadId), eq(threadMembers.userId, this.ctx.userId)); }

  /** Unread per conversation. */
  private unreadRows(tx: Tx, threadIds: string[]) {
    return tx.select({ threadId: messages.threadId, n: count() }).from(messages)
      .innerJoin(threadMembers, this.mine()).where(this.unread(threadIds)).groupBy(messages.threadId);
  }

  private people(tx: Tx, threadIds: string[]) {
    return tx.select({ threadId: threadMembers.threadId, id: users.id, name: users.name, role: users.role }).from(threadMembers)
      .innerJoin(users, eq(users.id, threadMembers.userId))
      .where(and(inArray(threadMembers.threadId, threadIds), ne(threadMembers.userId, this.ctx.userId))).orderBy(asc(users.name));
  }

  /** The caller's conversations, newest activity first, with unread counts and a preview of the last message. */
  async inbox(): Promise<InboxThread[]> {
    return this.read("use", async (tx) => {
      const mine = await tx.select({ t: messageThreads }).from(threadMembers)
        .innerJoin(messageThreads, eq(messageThreads.id, threadMembers.threadId))
        .where(eq(threadMembers.userId, this.ctx.userId)).orderBy(desc(messageThreads.lastMessageAt), asc(messageThreads.id)).limit(100);
      const ids = mine.map((m) => m.t.id);
      if (!ids.length) return [];
      const [people, last, unread] = await Promise.all([
        this.people(tx, ids),
        tx.selectDistinctOn([messages.threadId], { threadId: messages.threadId, body: messages.body, senderId: messages.senderId, senderName: users.name })
          .from(messages).leftJoin(users, eq(users.id, messages.senderId)).where(inArray(messages.threadId, ids)).orderBy(messages.threadId, desc(messages.createdAt)),
        this.unreadRows(tx, ids),
      ]);
      return mine.map(({ t }) => {
        const l = last.find((m) => m.threadId === t.id);
        return {
          id: t.id, subject: t.subject, kind: t.kind, lastMessageAt: t.lastMessageAt,
          people: people.filter((p) => p.threadId === t.id), unread: Number(unread.find((u) => u.threadId === t.id)?.n ?? 0),
          preview: l?.body ?? "", lastSenderName: l ? (l.senderId === this.ctx.userId ? "You" : l.senderName) : null,
        };
      });
    });
  }

  /** Total unread messages across the caller's conversations (the sidebar badge). */
  async unreadCount(): Promise<number> {
    return this.read("use", async (tx) => {
      const [row] = await tx.select({ n: count() }).from(messages).innerJoin(threadMembers, this.mine()).where(this.unread());
      return Number(row?.n ?? 0);
    });
  }

  /** One conversation with its messages (oldest first). Opening it marks exactly the messages shown as read. */
  async thread(id: string): Promise<ThreadView> {
    const load = async (tx: Tx): Promise<ThreadView> => {
      await this.requireMember(tx, id);
      const [[t], people, recent] = await Promise.all([
        tx.select().from(messageThreads).where(eq(messageThreads.id, id)).limit(1),
        this.people(tx, [id]),
        tx.select({ id: messages.id, senderId: messages.senderId, senderName: users.name, body: messages.body, createdAt: messages.createdAt })
          .from(messages).leftJoin(users, eq(users.id, messages.senderId)).where(eq(messages.threadId, id)).orderBy(desc(messages.createdAt)).limit(MAX_MESSAGES),
      ]);
      return {
        id, subject: t!.subject, kind: t!.kind, people,
        messages: recent.reverse().map((m) => ({ ...m, senderName: m.senderId === this.ctx.userId ? "You" : m.senderName ?? "Removed user" })),
      };
    };
    // A read-only school can still read its messages; it just cannot record that it did.
    if (this.ctx.readOnly) return this.read("use", load);
    return this.write("use", async (tx) => {
      const view = await load(tx);
      await this.markRead(tx, id, view.messages.map((m) => m.id));
      return view;
    });
  }

  /** Read up to the newest message the caller was actually shown (not "now"), so a message that lands meanwhile stays unread. */
  private markRead(tx: Tx, threadId: string, seen: string[]) {
    if (!seen.length) return Promise.resolve();
    const newest = sql`(select max(${messages.createdAt}) from ${messages} where ${inArray(messages.id, seen)})`;
    return tx.update(threadMembers).set({ lastReadAt: sql`greatest(coalesce(${threadMembers.lastReadAt}, '-infinity'::timestamptz), ${newest})` })
      .where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.userId, this.ctx.userId)));
  }

  /** Reply inside a conversation the caller is in. */
  async send(threadId: string, body: unknown): Promise<Message> {
    this.authorize("use", "write");
    const data = this.parse(sendInput, { threadId, body });
    return this.write("use", async (tx) => {
      await this.requireMember(tx, data.threadId);
      await this.limit(tx, false);
      return this.post(tx, data.threadId, data.body);
    });
  }

  /** Insert a message and move the conversation's clock. The sender's own messages never count as unread, so their read mark is left alone. */
  private async post(tx: Tx, threadId: string, body: string): Promise<Message> {
    const [msg] = await tx.insert(messages).values({ schoolId: this.ctx.schoolId, threadId, senderId: this.ctx.userId, body }).returning();
    await tx.update(messageThreads).set({ lastMessageAt: msg!.createdAt }).where(eq(messageThreads.id, threadId));
    const others = await tx.select({ userId: threadMembers.userId }).from(threadMembers).where(and(eq(threadMembers.threadId, threadId), ne(threadMembers.userId, this.ctx.userId)));
    await NotificationWriter.insert(tx, this.ctx.schoolId, others.map((o) => ({
      userId: o.userId, kind: "message" as const, title: `New message from ${this.ctx.name}`, body: body.slice(0, 200), href: `/app/messages?thread=${threadId}`,
    })));
    return msg!;
  }

  /** Start a conversation with one person (direct) or several (group), after checking the rules. */
  async start(input: unknown): Promise<{ id: string }> {
    this.authorize("use", "write");
    const data = this.parse(startInput, input);
    const recipients = [...new Set(data.recipientIds)].filter((id) => id !== this.ctx.userId);
    if (!recipients.length) throw new ValidationError({ recipientIds: "Pick at least one person other than yourself" });
    return this.write("use", async (tx) => {
      await this.limit(tx, true);
      const allowed = await this.rule.reachable(tx, this.ctx, inArray(users.id, recipients), PEOPLE_CAP);
      if (allowed.length !== recipients.length) throw new ForbiddenError("You cannot message one of these people.");
      const [thread] = await tx.insert(messageThreads).values({
        schoolId: this.ctx.schoolId, subject: data.subject, kind: recipients.length > 1 ? "group" : "direct", createdBy: this.ctx.userId,
      }).returning();
      await tx.insert(threadMembers).values([this.ctx.userId, ...recipients].map((userId) => ({ schoolId: this.ctx.schoolId, threadId: thread!.id, userId })));
      await this.post(tx, thread!.id, data.body);
      return { id: thread!.id };
    }, (r) => ({ action: "start", entity: "Conversation", entityId: r.id, summary: `Started conversation "${data.subject}" with ${recipients.length} ${recipients.length === 1 ? "person" : "people"}` }));
  }

  /** People the caller may start a conversation with, optionally filtered by name. */
  async contacts(q?: string): Promise<Contact[]> {
    const term = (q ?? "").trim().slice(0, 100);
    return this.read("use", (tx) => this.rule.reachable(tx, this.ctx, term ? ilike(users.name, `%${term}%`) : undefined, 20));
  }
}
