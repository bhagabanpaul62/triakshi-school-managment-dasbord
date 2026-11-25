// What people do to a request. Every method: permission, visibility (via `load`), the state table, the clock, the timeline and who is told.
import { and, asc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { ConflictError, ForbiddenError, ValidationError, type Ctx } from "@smw/feature-kit";
import { closeThread, isFamily, openThread, type UploadedFile } from "@smw/feature-messages/core";
import { leadIds } from "@smw/feature-messages/leads";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { type Viewer, scope } from "./access";
import type { Category, Req } from "./base";
import { addDays, autoCloseAt, dueFor, familyMayReopen, isOpen, resumeDue } from "./clock";
import { CLOSE_AFTER_DAYS, OPEN_STATES } from "./constants";
import { assignInput, categoryChangeInput, feedbackInput, mergeInput, optReasonInput, reasonInput, textInput } from "./inputs";
import { resolveRoute, STAFF_ROLES, type Route } from "./routing";
import { requestCategories, requests } from "./schema";
import { RequestReads } from "./reads";

type Run<T> = (tx: Tx, c: { v: Viewer; r: Req; cat: Category; about: Set<string> }) => Promise<T>;
const subjectOf = (r: Pick<Req, "id">) => ({ type: "request", id: r.id });

export abstract class RequestWorkflow extends RequestReads {
  constructor(ctx: Ctx) { super(ctx); }

  /** Load the request this person may see, run `fn`, audit it. */
  protected async act<T>(id: string, summary: string, fn: Run<T>): Promise<T> {
    this.authorize("use", "write");
    const about = new Set<string>();
    // The audit screen hides a complaint from the people it names, so every entry carries them.
    return this.write("use", async (tx) => { const c = await this.load(tx, id, true); c.r.aboutUserIds.forEach((u) => about.add(u)); return fn(tx, { ...c, about }); },
      () => ({ action: "update", entity: "Request", entityId: id, summary, meta: { aboutUserIds: [...about] } }));
  }

  private handled(tx: Tx, r: Req, ...people: (string | null)[]) {
    return Promise.all(people.filter((p): p is string => !!p).map((p) => NotificationWriter.done(tx, this.ctx.schoolId, subjectOf(r), p)));
  }

  private async person(tx: Tx, id: string) {
    const [u] = await tx.select({ userId: users.id, name: users.name, role: users.role }).from(users).where(and(eq(users.id, id), eq(users.status, "active")));
    return u ?? null;
  }

  /** The route for a category, for a request about these people and this child. */
  protected routeOf(tx: Tx, cat: Pick<Category, "ownerUserId" | "ownerRole" | "nature">, r: Pick<Req, "studentId" | "aboutUserIds">): Promise<Route> {
    return resolveRoute(tx, { userId: cat.ownerUserId, role: cat.ownerRole }, { studentId: r.studentId, nature: cat.nature, skip: r.aboutUserIds });
  }

  private async answerBy(tx: Tx, r: Req, body: string | undefined, files: UploadedFile[] | undefined, set: Partial<typeof requests.$inferInsert>) {
    await this.joinThread(tx, r);
    if (body || files?.length) await this.say(tx, r, body ?? "", { asOffice: true, files });
    return { ownerId: r.ownerId ?? this.ctx.userId, firstAnswerAt: r.firstAnswerAt ?? new Date(), ...set };
  }

  // ---------- who has it ----------

  async claim(id: string) {
    return this.act(id, "Took a request", async (tx, { v, r }) => {
      this.staffOnly(v);
      if (r.ownerId) throw new ConflictError(r.ownerId === this.ctx.userId ? "You already have this request." : `${(await this.person(tx, r.ownerId))?.name ?? "Someone else"} already has this request.`);
      const state = this.go(r, "assign");
      await this.joinThread(tx, r);
      await this.patch(tx, r.id, { ownerId: this.ctx.userId, state });
      await this.log(tx, r.id, "claimed", `Taken by ${this.ctx.name}`);
      await this.closeStaffWork(tx, r);
    });
  }

  /** The people this request may be given to. */
  async assignees(id: string): Promise<{ id: string; name: string; role: string }[]> {
    return this.read("use", async (tx) => {
      const { r, cat } = await this.load(tx, id);
      const only = cat.nature === "safety" ? await leadIds(tx, r.aboutUserIds) : null;
      const rows = await tx.select({ id: users.id, name: users.name, role: users.role }).from(users)
        .where(and(eq(users.status, "active"), inArray(users.role, STAFF_ROLES as never[]), only ? inArray(users.id, only) : undefined)).orderBy(asc(users.name));
      return rows.filter((u) => !r.aboutUserIds.includes(u.id));
    });
  }

  async assign(input: unknown) {
    const d = this.parse(assignInput, input);
    return this.act(d.id, "Gave a request to a person", async (tx, { v, r, cat }) => {
      this.staffOnly(v);
      if (!v.office && r.ownerId !== v.userId) throw new ForbiddenError("Only the office or the person who has this request can give it to someone else.");
      const state = this.go(r, "assign");
      const to = await this.person(tx, d.userId);
      const allowed = cat.nature === "safety" ? await leadIds(tx, r.aboutUserIds) : null;
      if (!to || !STAFF_ROLES.includes(to.role) || r.aboutUserIds.includes(to.userId) || (allowed && !allowed.includes(to.userId))) throw new ValidationError({ userId: "This person cannot take this request" });
      await this.joinThread(tx, r, to);
      await this.patch(tx, r.id, { ownerId: to.userId, state });
      await this.log(tx, r.id, "assigned", `Given to ${to.name}`);
      await this.closeStaffWork(tx, r);
      await this.tellStaff(tx, r, [to.userId], `Request ${r.number} is yours`, `${cat.name}. Open it to answer.`);
    });
  }

  async setCategory(input: unknown) {
    const d = this.parse(categoryChangeInput, input);
    return this.act(d.id, "Changed the category of a request", async (tx, { v, r, cat }) => {
      this.staffOnly(v);
      if (!v.office && r.ownerId !== v.userId) throw new ForbiddenError("Only the office or the person who has this request can change its category.");
      this.go(r, "assign");
      const [to] = await tx.select().from(requestCategories).where(and(eq(requestCategories.id, d.categoryId), eq(requestCategories.active, true)));
      if (!to) throw new ValidationError({ categoryId: "Choose a category that is turned on" });
      if (to.id === cat.id) throw new ConflictError("It is already in this category.");
      const route = await this.routeOf(tx, to, r);
      const now = new Date();
      if (route.ownerId) { const p = await this.person(tx, route.ownerId); if (p) await this.joinThread(tx, r, p); }
      await this.patch(tx, r.id, { categoryId: to.id, ownerId: route.ownerId, ownerRole: route.ownerRole, level: 0, dueAt: dueFor(now, to.targetDays), pausedAt: r.pausedAt ? now : null, state: r.state === "new" || r.state === "assigned" ? (route.ownerId ? "assigned" : "new") : r.state });
      await this.log(tx, r.id, "category", `Moved from ${cat.name} to ${to.name}`);
      await this.closeStaffWork(tx, r);
      await this.tellStaff(tx, r, route.notify, `Request ${r.number} moved to you`, `${to.name}. Open it to answer.`);
    });
  }

  // ---------- talking ----------

  async answer(id: string, body: unknown, files?: UploadedFile[]) {
    return this.act(id, "Answered a request", async (tx, { v, r }) => {
      this.staffOnly(v);
      const d = this.parse(textInput, { id, body });
      const state = this.go(r, "answer");
      await this.patch(tx, r.id, await this.answerBy(tx, r, d.body, files, { state }));
      await this.log(tx, r.id, "answered");
      await this.tellFamily(tx, r, `The school replied to request ${r.number}`, "Open it to read the reply.");
      await this.handled(tx, r, this.ctx.userId);
    });
  }

  /** A note for staff. The family never sees it, in the conversation, the timeline, search, files or notifications. */
  async internalNote(id: string, body: unknown) {
    return this.act(id, "Wrote a note on a request", async (tx, { v, r }) => {
      this.staffOnly(v);
      const d = this.parse(textInput, { id, body });
      if (r.state === "closed") throw new ConflictError("This request is closed. Open it again to add notes.");
      await this.joinThread(tx, r);
      await this.say(tx, r, d.body, { internal: true });
      await this.log(tx, r.id, "note", "Added a note for the school");
    });
  }

  /** Ask the family something. The clock stops until they answer. */
  async askFamily(id: string, body: unknown, files?: UploadedFile[]) {
    return this.act(id, "Asked the family a question", async (tx, { v, r }) => {
      this.staffOnly(v);
      const d = this.parse(textInput, { id, body });
      const state = this.go(r, "ask");
      await this.patch(tx, r.id, await this.answerBy(tx, r, d.body, files, { state, pausedAt: r.pausedAt ?? new Date() }));
      await this.log(tx, r.id, "asked", "Asked you a question");
      await this.tellFamily(tx, r, `The school needs your answer on ${r.number}`, "Open it to reply. The school's clock waits for you.", true);
      await this.handled(tx, r, this.ctx.userId);
    });
  }

  async start(id: string) {
    return this.act(id, "Started work on a request", async (tx, { v, r }) => {
      this.staffOnly(v);
      const state = this.go(r, "start");
      await this.joinThread(tx, r);
      await this.patch(tx, r.id, { state, ownerId: r.ownerId ?? this.ctx.userId });
      await this.log(tx, r.id, "started");
    });
  }

  /** The family writes back. If the school was waiting, the clock starts again with every day it had left. */
  async reply(id: string, body: unknown, files?: UploadedFile[]) {
    return this.act(id, "Replied to the school", async (tx, { v, r, cat }) => {
      this.familyOnly(v);
      const d = this.parse(textInput, { id, body });
      const state = this.go(r, "familyReply"), now = new Date();
      await this.say(tx, r, d.body, { files });
      await this.patch(tx, r.id, r.state === "waiting" ? { state, dueAt: resumeDue(r.dueAt, r.pausedAt ?? now, now), pausedAt: null } : { state });
      await this.log(tx, r.id, "replied");
      await this.handled(tx, r, this.ctx.userId);
      await this.tellStaff(tx, r, await this.workers(tx, r, cat), `The family replied on ${r.number}`, `${cat.name}. Open it to read.`);
    });
  }

  private async workers(tx: Tx, r: Req, cat: Category): Promise<string[]> {
    return r.ownerId ? [r.ownerId] : (await this.routeOf(tx, cat, r)).notify;
  }

  // ---------- finishing and coming back ----------

  async resolve(id: string, note?: unknown) {
    return this.act(id, "Resolved a request", async (tx, { v, r }) => {
      this.staffOnly(v);
      const state = this.go(r, "resolve");
      const text = typeof note === "string" && note.trim() ? this.parse(textInput, { id, body: note }).body : undefined;
      const now = new Date();
      await this.patch(tx, r.id, await this.answerBy(tx, r, text, undefined, { state, resolvedAt: now, pausedAt: null }));
      await this.log(tx, r.id, "resolved");
      await NotificationWriter.done(tx, this.ctx.schoolId, subjectOf(r));
      await this.tellFamily(tx, r, `Request ${r.number} is answered`, `Tell us if it is solved. If we hear nothing it closes by itself in ${CLOSE_AFTER_DAYS} days.`, true);
    });
  }

  async close(id: string, reason?: unknown) {
    return this.act(id, "Closed a request", async (tx, { v, r }) => {
      this.staffOnly(v);
      const d = this.parse(optReasonInput, { id, reason });
      this.go(r, "close");
      if (r.state !== "resolved" && !d.reason) throw new ValidationError({ reason: "Say why you are closing it" });
      await this.closeRow(tx, r, d.reason ?? "Closed after it was resolved");
      await this.log(tx, r.id, "closed", d.reason ? `Closed: ${d.reason}` : "Closed");
      await this.tellFamily(tx, r, `Request ${r.number} is closed`, d.reason ?? "It was resolved and is now closed.");
    });
  }

  private async closeRow(tx: Tx, r: Req, reason: string, set: Partial<typeof requests.$inferInsert> = {}) {
    await this.patch(tx, r.id, { state: "closed", closedAt: new Date(), pausedAt: null, ...set });
    await closeThread(tx, r.threadId, reason);
    await NotificationWriter.done(tx, this.ctx.schoolId, subjectOf(r));
  }

  /** The family says whether it is solved. Solved closes it; not solved opens it again. */
  async feedback(input: unknown) {
    const d = this.parse(feedbackInput, input);
    return this.act(d.id, "Gave feedback on a request", async (tx, { v, r, cat }) => {
      this.familyOnly(v);
      if (r.state !== "resolved") throw new ConflictError("You can say if it is solved once the school has answered.");
      if (d.solved) {
        await this.closeRow(tx, r, "Solved", { solved: true, feedback: d.note ?? null });
        await this.log(tx, r.id, "feedback", "Marked as solved");
        return;
      }
      await this.reopenRow(tx, r, cat, { solved: false, feedback: d.note ?? null, reason: d.note });
      await this.log(tx, r.id, "feedback", "Said it is not solved");
    });
  }

  async reopen(input: unknown) {
    const d = this.parse(optReasonInput, input);
    return this.act(d.id, "Opened a request again", async (tx, { v, r, cat }) => {
      if (r.mergedIntoId) throw new ConflictError("This request was joined with another one. Follow the other one instead.");
      if (v.family) {
        this.go(r, "reopen");
        if (!d.reason) throw new ValidationError({ reason: "Tell the school what is still wrong" });
        if (!familyMayReopen(r.resolvedAt ?? r.closedAt ?? new Date(), new Date())) throw new ConflictError("It has been more than 14 days. Please ask a new question, or call the school office.");
      }
      await this.reopenRow(tx, r, cat, { reason: d.reason });
      await this.log(tx, r.id, "reopened", d.reason ? `Opened again: ${d.reason}` : "Opened again");
    });
  }

  private async reopenRow(tx: Tx, r: Req, cat: Category, o: { reason?: string; solved?: boolean; feedback?: string | null }) {
    const state = this.go(r, "reopen");
    const v = isFamily(this.ctx.role);
    await openThread(tx, r.threadId);
    if (!v) await this.joinThread(tx, r);
    await this.patch(tx, r.id, { state, resolvedAt: null, closedAt: null, pausedAt: null, dueAt: dueFor(new Date(), cat.targetDays), reopenedCount: r.reopenedCount + 1, ...(o.solved === undefined ? {} : { solved: o.solved, feedback: o.feedback ?? null }) });
    if (o.reason) await this.say(tx, r, o.reason, { asOffice: !v });
    if (v) await this.tellStaff(tx, r, await this.workers(tx, r, cat), `Request ${r.number} was opened again`, `${cat.name}. The family says it is not done.`);
    else await this.tellFamily(tx, r, `Request ${r.number} is open again`, "The school opened it again.");
  }

  // ---------- escalation ----------

  /** A family may escalate only after it is resolved, and says why. Staff may at any time. */
  async escalate(input: unknown) {
    const d = this.parse(isFamily(this.ctx.role) ? reasonInput : optReasonInput, input);
    return this.act(d.id, "Sent a request to a higher level", async (tx, { v, r, cat }) => {
      if (!v.family && !isOpen(r.state)) throw new ConflictError("This request is finished. Open it again first.");
      if (v.family) {
        if (r.state !== "resolved") throw new ConflictError("You can send it higher once the school has answered and you are not happy with it.");
        if (!familyMayReopen(r.resolvedAt ?? new Date(), new Date())) throw new ConflictError("It has been more than 14 days. Please ask a new question, or call the school office.");
      }
      await this.moveUp(tx, r, cat, d.reason);
    });
  }

  /** One step up: the next level of the category takes it and gets a new clock. Used by people and by the hourly job. */
  protected async moveUp(tx: Tx, r: Req, cat: Category, reason?: string | null) {
    const target = cat.escalation[r.level];
    if (!target) throw new ConflictError("There is no higher level to send this to.");
    const state = this.go(r, "escalate"), now = new Date(), fromFamily = r.state === "resolved";
    const route = await this.routeOf(tx, { ownerUserId: null, ownerRole: target.role, nature: cat.nature }, r);
    if (fromFamily) await openThread(tx, r.threadId);
    if (route.ownerId) { const p = await this.person(tx, route.ownerId); if (p) await this.joinThread(tx, r, p); }
    await this.patch(tx, r.id, {
      state: fromFamily && !route.ownerId ? "new" : state, level: r.level + 1, ownerId: route.ownerId, ownerRole: route.ownerRole, dueAt: dueFor(now, target.afterDays),
      pausedAt: r.pausedAt ? now : null, ...(fromFamily ? { resolvedAt: null, reopenedCount: r.reopenedCount + 1 } : {}),
    });
    if (reason) await this.say(tx, r, reason, { asOffice: !isFamily(this.ctx.role) });
    await this.log(tx, r.id, "escalated", `Sent to ${target.label}`);
    await this.handled(tx, r, r.ownerId);
    await this.tellStaff(tx, r, route.notify, `Request ${r.number} needs you`, `${cat.name}: it reached ${target.label}.`);
    if (!fromFamily) await this.tellFamily(tx, r, `Request ${r.number} was sent to ${target.label}`, "A senior person at the school is now looking at it.");
  }

  // ---------- duplicates ----------

  /** Other open requests about the same child that this one could be joined to. */
  async mergeTargets(id: string): Promise<{ id: string; number: string; subject: string }[]> {
    return this.read("use", async (tx) => {
      const { v, r } = await this.load(tx, id);
      if (v.family || !r.studentId) return [];
      const rows = await this.select(tx).where(and(scope(tx, v), eq(requests.studentId, r.studentId), ne(requests.id, r.id), isNull(requests.mergedIntoId), inArray(requests.state, [...OPEN_STATES])));
      return rows.map((x) => ({ id: x.r.id, number: x.r.number, subject: x.subject }));
    });
  }

  /** Same child only. Nothing is moved: this one is closed with a link to the one that stays. */
  async merge(input: unknown) {
    const d = this.parse(mergeInput, input);
    return this.act(d.id, "Joined two requests", async (tx, { v, r, about }) => {
      this.staffOnly(v);
      if (d.intoId === r.id) throw new ValidationError({ intoId: "Choose a different request" });
      const keep = await this.load(tx, d.intoId, true).catch(() => null);
      if (!keep) throw new ValidationError({ intoId: "Choose a request you can see" });
      if (!r.studentId || keep.r.studentId !== r.studentId) throw new ValidationError({ intoId: "Only requests about the same child can be joined" });
      keep.r.aboutUserIds.forEach((u) => about.add(u));
      if (keep.r.mergedIntoId || !isOpen(keep.r.state)) throw new ValidationError({ intoId: "Choose a request that is still open" });
      this.go(r, "merge");
      await this.closeRow(tx, r, `Joined with ${keep.r.number}`, { mergedIntoId: keep.r.id });
      await this.systemLine(tx, r, `Closed: the school joined this with ${keep.r.number}.`);
      await this.log(tx, r.id, "merged", `Joined with ${keep.r.number}`);
      await this.log(tx, keep.r.id, "merged", `${r.number} was joined into this`);
      await this.tellFamily(tx, r, `Request ${r.number} was joined with ${keep.r.number}`, "It was the same question. Follow the other one.");
    });
  }

  // ---------- the hourly clock ----------

  /** Overdue requests move up one level, once per level; a resolved request closes by itself after 7 days, with a notice. Safe to run twice. */
  async clock(now = new Date()): Promise<{ escalated: number; closed: number }> {
    return this.write("manage", async (tx) => {
      const late = await tx.select({ r: requests, cat: requestCategories }).from(requests).innerJoin(requestCategories, eq(requestCategories.id, requests.categoryId))
        .where(and(inArray(requests.state, [...OPEN_STATES]), isNull(requests.pausedAt), lt(requests.dueAt, now))).orderBy(asc(requests.dueAt)).for("update", { of: requests, skipLocked: true });
      let escalated = 0;
      for (const { r, cat } of late) {
        if (!cat.escalation[r.level]) continue;
        await this.moveUp(tx, r, cat);
        escalated++;
      }
      const settled = await tx.select().from(requests).where(and(eq(requests.state, "resolved"), lt(requests.resolvedAt, addDays(now, -CLOSE_AFTER_DAYS)))).for("update", { skipLocked: true });
      for (const r of settled) {
        if (autoCloseAt(r.resolvedAt!) > now) continue;
        await this.closeRow(tx, r, "Closed by itself");
        await this.systemLine(tx, r, `Closed by itself ${CLOSE_AFTER_DAYS} days after it was answered. You can open it again within 14 days.`);
        await this.log(tx, r.id, "closed", `Closed by itself ${CLOSE_AFTER_DAYS} days after it was answered`);
        await this.tellFamily(tx, r, `Request ${r.number} was closed`, "It was answered a week ago. You can open it again within 14 days.");
      }
      return { escalated, closed: settled.length };
    });
  }
}

