// What every request service shares: the visibility rule, one place for the timeline, notifications and the conversation.
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { users, type Tx } from "@smw/db";
import { allows, ConflictError, ForbiddenError, NotFoundError, refuseSupport, SchoolService, type Ctx } from "@smw/feature-kit";
import { addMember, postMessage, postSystem, removeStored, storeFiles, type Message, type UploadedFile } from "@smw/feature-messages/core";
import { threadMembers } from "@smw/feature-messages/schema";
import { notifications } from "@smw/feature-notifications/schema";
import { NotificationWriter, type NotificationRow } from "@smw/feature-notifications/writer";
import { students } from "@smw/feature-students/schema";
import { viewerOf, scope, type Viewer } from "./access";
import { STAFF_ROLES } from "./routing";
import { REQUEST_STATE_WORDS, type RequestState } from "./constants";
import requestsFeature from "./feature";
import { next, type Action } from "./transitions";
import { requestCategories, requestEvents, requests } from "./schema";

export type Perm = keyof typeof requestsFeature.permissions;
export type Req = typeof requests.$inferSelect;
export type Category = typeof requestCategories.$inferSelect;
export const hrefOf = (r: Pick<Req, "id">) => `/app/requests/${r.id}`;

export abstract class RequestBase extends SchoolService<Perm> {
  protected feature = requestsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Triakshi support sees nothing of requests. A custom role with only the office grant may use the screens too. */
  protected authorize(permission: Perm, mode: "read" | "write") {
    refuseSupport(this.ctx, "use requests");
    super.authorize(permission === "use" && allows(this.ctx, this.feature, "office") ? "office" : permission, mode);
  }

  /** The request, only if this person may see it; anything else is "not found". A writer passes `lock`, so two people acting at once take turns and the second sees what the first did. */
  protected async load(tx: Tx, id: string, lock = false): Promise<{ v: Viewer; r: Req; cat: Category }> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Request");
    const v = await viewerOf(tx, this.ctx);
    const find = tx.select().from(requests).where(and(eq(requests.id, id), scope(tx, v)));
    const [r] = lock ? await find.for("update", { of: requests }) : await find;
    if (!r) throw new NotFoundError("Request");
    const [cat] = await tx.select().from(requestCategories).where(eq(requestCategories.id, r.categoryId));
    return { v, r, cat: cat! };
  }

  protected staffOnly(v: Viewer) { if (v.family) throw new ForbiddenError("Only the school can do this."); }
  protected familyOnly(v: Viewer) { if (!v.family) throw new ForbiddenError("Only the family can do this."); }

  /** The state after `action`, or a plain sentence saying why not. */
  protected go(r: Req, action: Action): RequestState {
    const s = next(r.state, action, !!r.ownerId);
    if (!s) throw new ConflictError(`This request is ${REQUEST_STATE_WORDS[r.state].toLowerCase()}, so that cannot be done now.`);
    return s;
  }

  protected async patch(tx: Tx, id: string, set: Partial<typeof requests.$inferInsert>): Promise<Req> {
    const [row] = await tx.update(requests).set({ ...set, updatedAt: new Date() }).where(eq(requests.id, id)).returning();
    return row!;
  }

  /** One line of the timeline. `detail` never holds the words of a note. */
  protected async log(tx: Tx, requestId: string, action: string, detail?: string) {
    await tx.insert(requestEvents).values({ schoolId: this.ctx.schoolId, requestId, action, detail: detail ?? null, byUserId: this.ctx.userId, byName: this.ctx.name });
  }

  protected familyUser = async (tx: Tx, r: Pick<Req, "studentId" | "raisedBy">): Promise<string | null> => {
    if (!r.studentId) return r.raisedBy;
    const [s] = await tx.select({ userId: students.userId }).from(students).where(eq(students.id, r.studentId));
    return s?.userId ?? null;
  };

  // ---------- notifications (never to a person the request is about, never to the person who acted) ----------

  /** Tell staff there is work: owner, new owner, escalation targets. */
  protected async tellStaff(tx: Tx, r: Req, people: string[], title: string, body: string) {
    const to = [...new Set(people)].filter((id) => id !== this.ctx.userId && !r.aboutUserIds.includes(id));
    await NotificationWriter.insert(tx, this.ctx.schoolId, to.map((userId): NotificationRow => ({
      userId, topic: "request.work", title, body, href: hrefOf(r), subject: { type: "request", id: r.id }, groupKey: `request:${r.id}:work`, action: true, privateBody: true,
    })));
  }

  /** Somebody has the request now: staff who were told it needed them no longer have to act. The family's own action rows stay. */
  protected async closeStaffWork(tx: Tx, r: Pick<Req, "id">) {
    const open = await tx.selectDistinct({ userId: notifications.userId }).from(notifications)
      .where(and(eq(notifications.subjectType, "request"), eq(notifications.subjectId, r.id), eq(notifications.topic, "request.work"), eq(notifications.action, true), isNull(notifications.doneAt)));
    await Promise.all(open.map((o) => NotificationWriter.done(tx, this.ctx.schoolId, { type: "request", id: r.id }, o.userId)));
  }

  /** Tell the family. `action` when they have something to do (answer, say if it is solved). */
  protected async tellFamily(tx: Tx, r: Req, title: string, body: string, action = false) {
    const userId = await this.familyUser(tx, r);
    if (!userId || userId === this.ctx.userId) return;
    await NotificationWriter.insert(tx, this.ctx.schoolId, [{
      userId, topic: "request.update", title, body, href: hrefOf(r), subject: { type: "request", id: r.id }, groupKey: `request:${r.id}:update`, action, privateBody: true,
    }]);
  }

  // ---------- the conversation ----------

  /** Staff become members of the conversation only when they own, answer or write a note. */
  protected async joinThread(tx: Tx, r: Pick<Req, "threadId">, who = { userId: this.ctx.userId, name: this.ctx.name, role: this.ctx.role as string }) {
    const [m] = await tx.select({ id: threadMembers.id }).from(threadMembers).where(and(eq(threadMembers.threadId, r.threadId), eq(threadMembers.userId, who.userId), eq(threadMembers.state, "active")));
    if (!m) await addMember(tx, this.ctx, r.threadId, who, { trusted: true });
  }

  /** Posts into the request's conversation. Files are stored first and removed again if the post fails. */
  protected async say(tx: Tx, r: Pick<Req, "threadId">, body: string, o: { internal?: boolean; asOffice?: boolean; files?: UploadedFile[] } = {}): Promise<Message> {
    const stored = o.files?.length ? await storeFiles(this.ctx.schoolId, r.threadId, o.files) : undefined;
    try { return await postMessage(tx, this.ctx, { threadId: r.threadId, body, files: stored, internal: o.internal, asOffice: o.asOffice, notify: false }); }
    catch (e) { if (stored) await removeStored(stored.map((s) => s.fileKey)); throw e; }
  }

  /** Staff who are in the conversation, for telling them the family wrote back. */
  protected async threadStaff(tx: Tx, r: Pick<Req, "threadId">): Promise<string[]> {
    const rows = await tx.select({ id: threadMembers.userId }).from(threadMembers).innerJoin(users, eq(users.id, threadMembers.userId))
      .where(and(eq(threadMembers.threadId, r.threadId), eq(threadMembers.state, "active"), inArray(users.role, STAFF_ROLES as never[]), ne(threadMembers.userId, this.ctx.userId)));
    return rows.map((x) => x.id!).filter(Boolean);
  }

  protected systemLine(tx: Tx, r: Pick<Req, "threadId">, text: string) { return postSystem(tx, this.ctx.schoolId, r.threadId, text); }
}
