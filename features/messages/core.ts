// The one door to conversations. Every module that talks to a family (messages, requests) goes through here, so the rules live once:
// only members read or write, a conversation has one family, limits, restrictions, quiet hours and the review banner.
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { users, type Tx } from "@smw/db";
import { allows, ConflictError, ForbiddenError, pgErrorCode, NotFoundError, ReadOnlyError, ValidationError, type Ctx } from "@smw/feature-kit";
import { quietUntil } from "@smw/feature-notifications/quiet";
import { notificationPrefs } from "@smw/feature-notifications/schema";
import { loadCommSettings, type CommSettings } from "@smw/feature-notifications/settings";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { students } from "@smw/feature-students/schema";
import { BODY_MAX, FAMILY_KINDS, MAX_FILES, NEW_PER_DAY, PER_MINUTE, REVIEW_HOURS, THREAD_WINDOW, type ThreadKind } from "./constants";
import messagesFeature from "./feature";
import { filePrefix, type StoredFile } from "./files";
import { messageFiles, messageRestrictions, messageReviews, messages, messageThreads, threadMembers } from "./schema";

export { filePrefix, removeStored, signedLink, sniff, storeFiles, type StoredFile, type UploadedFile } from "./files";

export type Message = typeof messages.$inferSelect;
export type ThreadRow = typeof messageThreads.$inferSelect;
type MemberRow = typeof threadMembers.$inferSelect;

export interface Member { userId: string; name: string; role: string }
/** Who to add. Name and role are read from the database; anything passed here is ignored. */
export type Who = { userId: string; name?: string; role?: string }
/** Who is looking. A Ctx fits. `review` is set only by the safeguarding service after it logged why. */
export interface Viewer { userId: string; role: string; supportStaffId?: string | null; review?: boolean }

export const isFamily = (role: string) => role === "student" || role === "parent";
/** Today in IST as YYYY-MM-DD. */
export const istToday = (now = Date.now()) => new Date(now + 330 * 60_000).toISOString().slice(0, 10);
const clock = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" });
const lockOn = (tx: Tx, key: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);

/** Triakshi support works inside a school's account but never inside its private conversations. */
export function noSupport(who: { supportStaffId?: string | null }) {
  if (who.supportStaffId) throw new ForbiddenError("Private messages are not available in a support session.");
}

// ---------- guards ----------

/** The only way to a conversation. Not a member (or a conversation that does not exist) is "not found", so nobody learns what exists. */
export async function requireMember(tx: Tx, ctx: Pick<Ctx, "userId" | "supportStaffId">, threadId: string): Promise<{ thread: ThreadRow; member: MemberRow }> {
  noSupport(ctx);
  if (!z.uuid().safeParse(threadId).success) throw new NotFoundError("Conversation");
  const [row] = await tx.select({ thread: messageThreads, member: threadMembers }).from(threadMembers)
    .innerJoin(messageThreads, eq(messageThreads.id, threadMembers.threadId))
    .where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.userId, ctx.userId), eq(threadMembers.state, "active"))).limit(1);
  if (!row) throw new NotFoundError("Conversation");
  return row;
}

/** The sql trigger is the last line of defence; its refusal reads like the service's. */
const oneFamily = async (insert: () => PromiseLike<unknown>) => {
  try { await insert(); } catch (e) { if (pgErrorCode(e) === "23514") throw new ConflictError("A conversation can have only one family in it."); throw e; }
};

/** A student conversation or request has exactly one family, the student's own login; a staff conversation has none. The sql trigger repeats this. */
export async function assertOneFamily(tx: Tx, threadId: string): Promise<void> {
  const [t] = await tx.select({ kind: messageThreads.kind, studentId: messageThreads.studentId }).from(messageThreads).where(eq(messageThreads.id, threadId)).for("update");
  if (!t || t.kind === "legacy") return;
  const rows = await tx.select({ userId: threadMembers.userId, role: threadMembers.role }).from(threadMembers).where(eq(threadMembers.threadId, threadId));
  const families = new Set(rows.filter((r) => isFamily(r.role)).map((r) => r.userId));
  if (t.kind === "staff" ? families.size > 0 : families.size > 1) throw new ConflictError("A conversation can have only one family in it.");
  if (t.kind !== "staff" && t.studentId && families.size === 1) {
    const [s] = await tx.select({ userId: students.userId }).from(students).where(eq(students.id, t.studentId));
    if (!s || !families.has(s.userId as string)) throw new ConflictError("That family login does not belong to this student.");
  }
}

// ---------- limits and restrictions ----------

/** A restriction that is in force today. Blocked wins over reply only. */
export async function activeRestriction(tx: Tx, userId: string) {
  const rows = await tx.select({ kind: messageRestrictions.kind, until: messageRestrictions.until }).from(messageRestrictions)
    .where(and(eq(messageRestrictions.userId, userId), isNull(messageRestrictions.liftedAt), sql`${messageRestrictions.until} >= ${istToday()}::date`));
  return rows.find((r) => r.kind === "blocked") ?? rows[0];
}

async function checkRate(tx: Tx, userId: string) {
  await lockOn(tx, `msg-rate:${userId}`);
  // Messages sent through "Message families" do not count: a teacher writing to 40 families may still reply to one.
  const recent = await tx.select({ at: messages.createdAt }).from(messages).innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
    .where(and(eq(messages.senderId, userId), isNull(messageThreads.batchId), sql`${messages.createdAt} > now() - interval '1 minute'`)).orderBy(asc(messages.createdAt));
  if (recent.length >= PER_MINUTE) throw new ValidationError({ body: `That is a lot of messages. Try again at ${clock(new Date(recent[recent.length - PER_MINUTE]!.at.getTime() + 60_000))}.` });
}

async function checkNewPerDay(tx: Tx, ctx: Pick<Ctx, "userId" | "role">) {
  await lockOn(tx, `thread-rate:${ctx.userId}`);
  const [r] = await tx.select({ n: count(), first: sql<Date | null>`min(${messageThreads.createdAt})` }).from(messageThreads)
    .where(and(eq(messageThreads.createdBy, ctx.userId), isNull(messageThreads.batchId), sql`${messageThreads.createdAt} > now() - interval '1 day'`));
  const cap = isFamily(ctx.role) ? NEW_PER_DAY.family : NEW_PER_DAY.staff;
  if (Number(r?.n) >= cap) {
    const when = new Date(new Date(r!.first as unknown as string).getTime() + 86_400_000);
    throw new ValidationError({ body: `You have started many conversations today. Try again at ${clock(when)}.` });
  }
}

// ---------- people ----------

/** The real name and role of each person, from the database and this school only. A caller's claim is never trusted. */
async function realPeople(tx: Tx, schoolId: string, wanted: Who[]): Promise<Member[]> {
  const ids = [...new Set(wanted.map((m) => m.userId))];
  if (!ids.every((id) => z.uuid().safeParse(id).success)) throw new ValidationError({ recipientIds: "One of these people cannot receive messages." });
  const rows = await tx.select({ userId: users.id, name: users.name, role: users.role }).from(users)
    .where(and(eq(users.schoolId, schoolId), eq(users.status, "active"), inArray(users.id, ids)));
  if (rows.length !== ids.length) throw new ValidationError({ recipientIds: "One of these people cannot receive messages." });
  return rows;
}

export interface NewThread { kind: Exclude<ThreadKind, "legacy">; subject: string; studentId?: string | null; batchId?: string | null; members: Who[] }

export async function createThread(tx: Tx, ctx: Ctx, input: NewThread): Promise<ThreadRow> {
  noSupport(ctx);
  if (ctx.readOnly) throw new ReadOnlyError();
  const subject = input.subject.trim();
  if (subject.length < 2 || subject.length > 120) throw new ValidationError({ subject: "Add a subject (2 to 120 characters)" });
  const familyKind = FAMILY_KINDS.includes(input.kind);
  if (familyKind && !input.studentId) throw new ValidationError({ studentId: "Choose the student this is about" });
  if (!familyKind && input.studentId) throw new ValidationError({ studentId: "A staff conversation is not about a student" });
  const wanted = input.members.some((m) => m.userId === ctx.userId) ? input.members : [{ userId: ctx.userId }, ...input.members];
  const people = await realPeople(tx, ctx.schoolId, wanted);
  const families = people.filter((p) => isFamily(p.role));
  if (!familyKind && families.length) throw new ValidationError({ recipientIds: "A staff conversation cannot include a family." });
  if (familyKind) {
    if (families.length !== 1) throw new ValidationError({ recipientIds: "A conversation is with one family only." });
    const [s] = await tx.select({ userId: students.userId }).from(students).where(and(eq(students.id, input.studentId!), eq(students.status, "active")));
    if (!s || s.userId !== families[0]!.userId) throw new ValidationError({ studentId: "That family login does not belong to this student." });
  }
  if (people.length < 2) throw new ValidationError({ recipientIds: "Pick at least one person other than yourself" });
  const restricted = await activeRestriction(tx, ctx.userId);
  if (restricted) throw new ForbiddenError(`The school has limited your messages until ${restricted.until}. You can still reply to conversations you are in. Contact the school office.`);
  if (!input.batchId) await checkNewPerDay(tx, ctx);
  const [thread] = await tx.insert(messageThreads).values({ schoolId: ctx.schoolId, kind: input.kind, subject, studentId: input.studentId ?? null, batchId: input.batchId ?? null, createdBy: ctx.userId }).returning();
  await oneFamily(() => tx.insert(threadMembers).values(people.map((p) => ({ schoolId: ctx.schoolId, threadId: thread!.id, userId: p.userId, name: p.name, role: p.role }))));
  await assertOneFamily(tx, thread!.id);
  return thread!;
}

/**
 * Add a person to a conversation. The caller must be in it. `trusted` is for a module that has already checked the actor by its own
 * permission (the requests queue assigning an owner); it is the only way past membership and never set from a form.
 */
export async function addMember(tx: Tx, ctx: Ctx, threadId: string, who: Who, opts: { trusted?: boolean } = {}): Promise<void> {
  noSupport(ctx);
  if (ctx.readOnly) throw new ReadOnlyError();
  if (!opts.trusted) await requireMember(tx, ctx, threadId);
  const [t] = await tx.select({ kind: messageThreads.kind }).from(messageThreads).where(eq(messageThreads.id, threadId));
  if (!t) throw new NotFoundError("Conversation");
  if (t.kind === "legacy") throw new ForbiddenError("This is an old group conversation, so it is read only.");
  const [p] = await realPeople(tx, ctx.schoolId, [who]);
  await oneFamily(() => tx.insert(threadMembers).values({ schoolId: ctx.schoolId, threadId, userId: p!.userId, name: p!.name, role: p!.role })
    .onConflictDoUpdate({ target: [threadMembers.threadId, threadMembers.userId], set: { state: "active", archived: false } }));
  await assertOneFamily(tx, threadId);
}

// ---------- unread ----------

/**
 * Messages from others the person has not opened, per conversation. The inbox and the sidebar badge both read this, so they always agree.
 * Requests have their own badge: `requests: false` (the default) counts every other kind, `true` only requests, so no message is counted twice.
 */
export async function unreadByThread(tx: Tx, who: { userId: string; role: string }, threadIds?: string[], requests = false): Promise<Map<string, number>> {
  const rows = await tx.select({ threadId: messages.threadId, n: count() }).from(messages)
    .innerJoin(threadMembers, and(eq(threadMembers.threadId, messages.threadId), eq(threadMembers.userId, who.userId), eq(threadMembers.state, "active")))
    .innerJoin(messageThreads, and(eq(messageThreads.id, messages.threadId), requests ? eq(messageThreads.kind, "request") : ne(messageThreads.kind, "request")))
    .where(and(
      sql`${messages.senderId} is distinct from ${who.userId}`, isNull(messages.removedAt), eq(messages.kind, "text"),
      isFamily(who.role) ? eq(messages.internal, false) : undefined,
      sql`(${threadMembers.lastReadAt} is null or ${messages.createdAt} > ${threadMembers.lastReadAt})`,
      threadIds ? inArray(messages.threadId, threadIds) : undefined,
    )).groupBy(messages.threadId);
  return new Map(rows.map((r) => [r.threadId, Number(r.n)]));
}

/** Mark read up to the newest message the person was shown (`upTo`, a timestamp text from loadThread), never "now", so a message that lands meanwhile stays unread. Clears the bell row and pending push and email in the same transaction. */
export async function markThreadRead(tx: Tx, ctx: Ctx, threadId: string, upTo?: string | null): Promise<void> {
  const { member } = await requireMember(tx, ctx, threadId);
  if (upTo) {
    await tx.update(threadMembers).set({ lastReadAt: sql`greatest(coalesce(${threadMembers.lastReadAt}, '-infinity'::timestamptz), ${upTo}::timestamptz)` }).where(eq(threadMembers.id, member.id));
  }
  await NotificationWriter.seen(tx, ctx.schoolId, { type: "thread", id: threadId }, ctx.userId);
}

// ---------- posting ----------

export interface PostInput {
  threadId: string; body: string; clientId?: string | null; files?: StoredFile[];
  /** A note for staff inside a request: never shown to the family, never notified. */
  internal?: boolean;
  /** Shown to the family as "School office (name)". */
  asOffice?: boolean;
  /** A centred line such as "Riya joined". */
  system?: boolean;
  /** False when the caller sends its own notification. */
  notify?: boolean;
  /** Only "Message families" sets this: sending to many families is not a flood. */
  skipLimit?: boolean;
}

/** The quiet-hours rule for one person: their own hours, else the school's. */
export const quietRule = (s: CommSettings, p?: { quietFrom: string | null; quietTo: string | null; awayUntil: string | null } | null) =>
  ({ from: p?.quietFrom ?? s.quietFrom, to: p?.quietTo ?? s.quietTo, sundays: s.quietSundays, awayUntil: p?.awayUntil ?? null });

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;
export const officeLabel = (s: Pick<CommSettings, "officeName">, name: string) => `${s.officeName} (${firstName(name)})`;

export async function postMessage(tx: Tx, ctx: Ctx, input: PostInput): Promise<Message> {
  const { thread, member } = await requireMember(tx, ctx, input.threadId);
  if (ctx.readOnly) throw new ReadOnlyError();
  const family = isFamily(ctx.role);
  const body = (input.body ?? "").trim();
  const files = input.files ?? [];
  if (body.length > BODY_MAX) throw new ValidationError({ body: `Keep it under ${BODY_MAX} characters` });
  if (!body && !files.length) throw new ValidationError({ body: "Write a message" });

  // A double press or a retry carries the same client id and stores one message.
  if (input.clientId) {
    const [dup] = await tx.select().from(messages).where(and(eq(messages.senderId, ctx.userId), eq(messages.clientId, input.clientId)));
    if (dup) return dup;
  }
  if (thread.kind === "legacy") throw new ForbiddenError("This is an old group conversation, so it is read only.");
  if (thread.state === "closed") throw new ForbiddenError(`This conversation is closed${thread.closedReason ? `: ${thread.closedReason}` : ""}.`);
  if (input.internal && (family || thread.kind !== "request")) throw new ForbiddenError("Internal notes are for staff, inside a request.");
  if (input.asOffice && family) throw new ForbiddenError();

  const settings = await loadCommSettings(tx);
  if (family && thread.kind === "student" && !settings.familiesMayReply) throw new ForbiddenError("The school has turned off replies from families here. Please contact the school office.");
  if (files.length) {
    if (!settings.attachments) throw new ValidationError({ files: "The school has turned attachments off." });
    const prefix = filePrefix(ctx.schoolId, thread.id);
    if (files.length > MAX_FILES || files.some((f) => !f.fileKey.startsWith(prefix))) throw new ValidationError({ files: `Attach at most ${MAX_FILES} files` });
  }
  if ((await activeRestriction(tx, ctx.userId))?.kind === "blocked") throw new ForbiddenError("The school has switched off your messages for now. Please contact the school office.");

  const others = await tx.select({ userId: threadMembers.userId, name: threadMembers.name, muted: threadMembers.muted, status: users.status }).from(threadMembers)
    .leftJoin(users, eq(users.id, threadMembers.userId)).where(and(eq(threadMembers.threadId, thread.id), eq(threadMembers.state, "active"), ne(threadMembers.userId, ctx.userId)));
  const reachable = others.filter((o) => o.userId && o.status === "active");
  if (!input.internal && !input.system && others.length && !reachable.length) {
    throw new ForbiddenError(`This cannot be delivered: ${others.map((o) => o.name).join(", ")} can no longer sign in. Please contact the school office.`);
  }
  if (!input.skipLimit && !input.internal && !input.system) await checkRate(tx, ctx.userId);

  // Quiet hours: the app shows it at once; push and email wait for each person's morning.
  const to = input.internal || input.system || input.notify === false ? [] : reachable.filter((o) => !o.muted);
  const prefs = to.length ? await tx.select().from(notificationPrefs).where(inArray(notificationPrefs.userId, to.map((o) => o.userId!))) : [];
  const now = new Date();
  const waits = new Map(to.map((o) => {
    const p = prefs.find((x) => x.userId === o.userId);
    return [o.userId!, quietUntil(now, quietRule(settings, p))] as const;
  }));
  const later = [...waits.values()].filter((d): d is Date => !!d);
  const deliverAfter = later.length ? new Date(Math.max(...later.map((d) => d.getTime()))) : null;

  const [msg] = await tx.insert(messages).values({
    schoolId: ctx.schoolId, threadId: thread.id, senderId: ctx.userId, senderName: member.name, kind: input.system ? "system" : "text", body,
    clientId: input.clientId ?? null, internal: !!input.internal, asOffice: !!input.asOffice, deliverAfter,
  }).onConflictDoNothing().returning();
  if (!msg) {
    const [dup] = await tx.select().from(messages).where(and(eq(messages.senderId, ctx.userId), eq(messages.clientId, input.clientId!)));
    return dup!;
  }
  if (files.length) await tx.insert(messageFiles).values(files.map((f) => ({ schoolId: ctx.schoolId, messageId: msg.id, fileKey: f.fileKey, fileName: f.fileName, contentType: f.contentType, size: f.size })));
  if (!input.internal) {
    await tx.update(messageThreads).set({ lastMessageAt: msg.createdAt }).where(eq(messageThreads.id, thread.id));
    await tx.update(threadMembers).set({ archived: false }).where(and(eq(threadMembers.threadId, thread.id), ne(threadMembers.userId, ctx.userId)));
  }
  if (to.length) {
    const shown = input.asOffice ? officeLabel(settings, member.name) : member.name;
    await NotificationWriter.insert(tx, ctx.schoolId, to.map((o) => ({
      userId: o.userId!, topic: "message.new" as const, title: `New message from ${shown}`, body: (body || `${files.length} attachment${files.length === 1 ? "" : "s"}`).slice(0, 200),
      href: `/app/messages?thread=${thread.id}`, subject: { type: "thread", id: thread.id }, groupKey: `thread:${thread.id}`, privateBody: true, deliverAfter: waits.get(o.userId!) ?? undefined,
    })));
  }
  return msg;
}

/** The only writers of a conversation's open or closed state; closed is read only. */
export const closeThread = (tx: Tx, threadId: string, reason: string) => tx.update(messageThreads).set({ state: "closed", closedReason: reason }).where(eq(messageThreads.id, threadId));
export const openThread = (tx: Tx, threadId: string) => tx.update(messageThreads).set({ state: "open", closedReason: null }).where(eq(messageThreads.id, threadId));

/** A line from the system itself ("Closed: Mr Rao no longer teaches Riya"). No member, no notification: for jobs and admin actions. */
export async function postSystem(tx: Tx, schoolId: string, threadId: string, text: string): Promise<void> {
  const [m] = await tx.insert(messages).values({ schoolId, threadId, senderId: null, senderName: "School", kind: "system", body: text.slice(0, 500) }).returning();
  await tx.update(messageThreads).set({ lastMessageAt: m!.createdAt }).where(eq(messageThreads.id, threadId));
}

// ---------- reading ----------

export interface FileView { id: string; name: string; size: number; type: string }
export interface MessageView {
  id: string; kind: "text" | "system" | "note"; senderId: string | null; sender: string; mine: boolean; body: string; at: Date; atText: string; deliverAfter: Date | null;
  removed: boolean; removedByName: string | null; files: FileView[];
  /** My messages only: how many of the other people have seen it (after quiet hours) and when. */
  seen: { by: number; of: number; at: Date | null } | null;
}
export interface MemberView { userId: string | null; name: string; role: string; state: string; mine: boolean; canReceive: boolean; away: { until: string; text: string | null } | null }
export interface ThreadData {
  thread: { id: string; kind: ThreadKind; subject: string; state: "open" | "closed"; closedReason: string | null; held: boolean; studentId: string | null; studentName: string | null; batchId: string | null; createdBy: string | null };
  members: MemberView[]; messages: MessageView[]; hasOlder: boolean;
  /** My own pin, mute and archive marks on this conversation. */
  flags: { pinned: boolean; muted: boolean; archived: boolean };
  /** created_at of the newest message returned, as text, to pass to markThreadRead. */
  newestAt: string | null; oldestAt: string | null;
  officeName: string;
  /** When the others would be told, if I wrote now: their quiet hours or away days. Null when they would be told at once. */
  holdUntil: Date | null;
}

export async function loadThread(tx: Tx, threadId: string, viewer: Viewer, o: { before?: string | null; limit?: number } = {}): Promise<ThreadData> {
  noSupport(viewer);
  let thread: ThreadRow;
  if (viewer.review) {
    if (!z.uuid().safeParse(threadId).success) throw new NotFoundError("Conversation");
    const [t] = await tx.select().from(messageThreads).where(eq(messageThreads.id, threadId));
    if (!t) throw new NotFoundError("Conversation");
    thread = t;
  } else thread = (await requireMember(tx, viewer, threadId)).thread;

  const family = isFamily(viewer.role);
  const limit = o.limit ?? THREAD_WINDOW;
  const settings = await loadCommSettings(tx);
  const [allMembers, recent, [stu], noteOnly] = await Promise.all([
    tx.select({ m: threadMembers, status: users.status }).from(threadMembers).leftJoin(users, eq(users.id, threadMembers.userId)).where(eq(threadMembers.threadId, thread.id)).orderBy(asc(threadMembers.createdAt)),
    tx.select({ m: messages, at: sql<string>`${messages.createdAt}::text` }).from(messages)
      .where(and(eq(messages.threadId, thread.id), family ? eq(messages.internal, false) : undefined, o.before ? sql`${messages.createdAt} < ${o.before}::timestamptz` : undefined))
      .orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit + 1),
    thread.studentId ? tx.select({ name: students.name }).from(students).where(eq(students.id, thread.studentId)) : Promise.resolve([] as { name: string }[]),
    // A family never learns that office staff were here: people who wrote only internal notes are not shown as members.
    family ? tx.select({ id: messages.senderId }).from(messages).where(and(eq(messages.threadId, thread.id), eq(messages.kind, "text"), isNotNull(messages.senderId))).groupBy(messages.senderId).having(sql`bool_and(${messages.internal})`) : Promise.resolve([] as { id: string | null }[]),
  ]);
  const hidden = new Set(noteOnly.map((n) => n.id));
  const members = allMembers.filter((x) => !(x.m.userId && hidden.has(x.m.userId) && !isFamily(x.m.role)));
  const hasOlder = recent.length > limit;
  const page = recent.slice(0, limit).reverse();
  const ids = page.map((p) => p.m.id);
  const [files, prefs] = await Promise.all([
    ids.length ? tx.select().from(messageFiles).where(inArray(messageFiles.messageId, ids)) : Promise.resolve([]),
    tx.select().from(notificationPrefs).where(inArray(notificationPrefs.userId, members.map((x) => x.m.userId).filter((u): u is string => !!u))),
  ]);

  const today = istToday(), now = new Date();
  const prefOf = (id: string | null) => prefs.find((p) => p.userId === id);
  const active = members.filter((x) => x.m.state === "active");
  // A person who read a message in quiet hours is shown as having seen it only when their morning comes.
  const seenAt = (x: (typeof members)[number]): Date | null => {
    const at = x.m.lastReadAt;
    if (!at) return null;
    const p = prefOf(x.m.userId);
    const held = quietUntil(at, quietRule(settings, p ? { ...p, awayUntil: null } : null));
    return held && held > now ? null : at;
  };
  const staffSeenHidden = family && !settings.showStaffSeen;
  const removers = new Map(members.filter((x) => x.m.userId).map((x) => [x.m.userId!, x.m.name]));

  const views: MessageView[] = page.map(({ m, at }) => {
    const mine = m.senderId === viewer.userId;
    const removed = !!m.removedAt;
    const showOriginal = !!viewer.review;
    const recipients = mine ? active.filter((x) => x.m.userId !== viewer.userId && (!staffSeenHidden || isFamily(x.m.role))) : [];
    const seen = mine && m.kind === "text" && !m.internal && !staffSeenHidden
      ? { by: recipients.filter((x) => { const s = seenAt(x); return s && s >= m.createdAt; }).length, of: recipients.length, at: recipients.map(seenAt).filter((s): s is Date => !!s && s >= m.createdAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null }
      : null;
    return {
      id: m.id, kind: m.kind === "system" ? "system" : m.internal ? "note" : "text", senderId: m.senderId, mine,
      sender: m.asOffice && family ? officeLabel(settings, m.senderName) : m.senderName,
      body: removed && !showOriginal ? "" : m.body, at: m.createdAt, atText: at, deliverAfter: m.deliverAfter && m.deliverAfter > now ? m.deliverAfter : null,
      removed, removedByName: m.removedBy && m.removedBy !== m.senderId ? removers.get(m.removedBy) ?? "the school" : null,
      files: removed && !showOriginal ? [] : files.filter((f) => f.messageId === m.id).map((f) => ({ id: f.id, name: f.fileName, size: f.size, type: f.contentType })),
      seen: seen && seen.of > 0 ? seen : null,
    };
  });

  return {
    thread: { id: thread.id, kind: thread.kind, subject: thread.subject, state: thread.state, closedReason: thread.closedReason, held: !!thread.heldAt, studentId: thread.studentId, studentName: stu?.name ?? null, batchId: thread.batchId, createdBy: thread.createdBy },
    members: members.map((x) => {
      const p = prefOf(x.m.userId);
      return {
        userId: x.m.userId, name: x.m.name, role: x.m.role, state: x.m.state, mine: x.m.userId === viewer.userId, canReceive: x.status === "active",
        away: p?.awayUntil && p.awayUntil >= today && x.m.state === "active" ? { until: p.awayUntil, text: p.awayText ?? null } : null,
      };
    }),
    flags: (({ pinned, muted, archived }) => ({ pinned, muted, archived }))(members.find((x) => x.m.userId === viewer.userId)?.m ?? { pinned: false, muted: false, archived: false }),
    messages: views, hasOlder, newestAt: page.at(-1)?.at ?? null, oldestAt: page[0]?.at ?? null, officeName: settings.officeName,
    holdUntil: holdUntil(active.filter((x) => x.m.userId !== viewer.userId).map((x) => quietUntil(now, quietRule(settings, prefOf(x.m.userId))))),
  };
}

const holdUntil = (waits: (Date | null)[]) => (waits.length && waits.every((w) => w) ? new Date(Math.min(...waits.map((w) => w!.getTime()))) : null);

/** Is there a logged review by this person that is still open? Opens the files of a conversation they are not in. */
export async function hasActiveReview(tx: Tx, userId: string, threadId: string): Promise<boolean> {
  const [r] = await tx.select({ id: messageReviews.id }).from(messageReviews).where(and(
    eq(messageReviews.threadId, threadId), eq(messageReviews.reviewerId, userId), sql`${messageReviews.createdAt} > now() - make_interval(hours => ${REVIEW_HOURS})`)).limit(1);
  return !!r;
}

/** Can this person see the thread at all (member or review)? For file routes and export. */
export async function canOpenThread(tx: Tx, who: Viewer, threadId: string): Promise<boolean> {
  try { await requireMember(tx, who, threadId); return true; } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
  return hasActiveReview(tx, who.userId, threadId);
}

/** Does the caller hold `permission` of messages? For code that has a Ctx but no service. */
export const may = (ctx: Ctx, permission: keyof typeof messagesFeature.permissions) => allows(ctx, messagesFeature, permission);

