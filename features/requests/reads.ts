import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { users, type Tx } from "@smw/db";
import { listQuerySchema, NotFoundError, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { loadThread, markThreadRead, readStored, signedLink, unreadByThread, type StoredBytes, type ThreadData } from "@smw/feature-messages/core";
import { LINK_SECONDS } from "@smw/feature-messages/constants";
import { messageFiles, messages, messageThreads, threadMembers } from "@smw/feature-messages/schema";
import { leadIds } from "@smw/feature-messages/leads";
import { loadCommSettings } from "@smw/feature-notifications/settings";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { sections, classes } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { scope, viewerOf, type Viewer } from "./access";
import { RequestBase, type Req } from "./base";
import { officeIds } from "./routing";
import { canDo } from "./can";
import { familyMayReopen, isOverdue, DAY } from "./clock";
import { FAMILY_EVENTS, OPEN_STATES, PAGE_SIZE, type EscalationLevel, type RequestField, type RequestState, type ViewKey } from "./constants";
import { listFilters } from "./inputs";
import { requestCategories, requestEvents, requests } from "./schema";

export interface RequestRow {
  id: string; number: string; subject: string; state: RequestState; categoryName: string; nature: string; studentName: string | null; className: string | null;
  raisedByName: string; ownerName: string | null; level: number; dueAt: Date; paused: boolean; overdue: boolean; ageDays: number; createdAt: Date; resolvedAt: Date | null;
}
export interface TimelineEntry { id: string; at: Date; action: string; text: string; by: string }
export interface RequestView extends RequestRow {
  categoryId: string; studentId: string | null; raisedBy: string | null; ownerId: string | null; ownerRole: string;
  /** The category's own fields with what was answered. */
  answers: { label: string; value: string }[];
  linked: { label: string; href: string } | null;
  firstAnswerAt: Date | null; closedAt: Date | null; reopenedCount: number; solved: boolean | null; feedback: string | null;
  mergedInto: { id: string; number: string } | null;
  nextLevel: string | null;
  /** The level it sits at now, once escalated ("Office"); null while with the owner. */
  levelName: string | null;
  /** Names of the people the family named. Never shown to them. */
  about: string[];
  thread: ThreadData;
  timeline: TimelineEntry[];
  /** True when nobody on staff may see this (it is about the only people who could): the family is shown outside contacts. */
  needsOutsideHelp: boolean;
  safetyContacts: { name: string; phone: string }[];
  can: Record<string, boolean>;
}

const WORDS: Record<string, string> = {
  raised: "Request raised", assigned: "Given to a person", claimed: "Taken by a person", answered: "Answered", asked: "Asked the family a question", replied: "The family replied", note: "Added a note for the school",
  started: "Work started", resolved: "Marked as resolved", closed: "Closed", reopened: "Opened again", escalated: "Sent to a higher level", merged: "Joined with another request", category: "Moved to another category", feedback: "Feedback given",
};

export abstract class RequestReads extends RequestBase {
  /** The saved view as a where clause. */
  private view(v: Viewer, key: ViewKey, now: Date): SQL | undefined {
    const open = inArray(requests.state, [...OPEN_STATES]);
    switch (key) {
      case "mine": return and(eq(requests.ownerId, v.userId), open);
      case "unassigned": return and(isNull(requests.ownerId), open);
      case "team": return and(isNotNull(requests.ownerId), ne(requests.ownerId, v.userId), open);
      case "overdue": return and(open, isNull(requests.pausedAt), lt(requests.dueAt, now));
      default: return undefined;
    }
  }

  private filtered(tx: Tx, v: Viewer, q: { q?: string; filters: Record<string, string | undefined> }, now = new Date()) {
    const f = this.parse(listFilters, q.filters);
    const term = q.q ? `%${q.q.replace(/[%_\\]/g, "\\$&")}%` : undefined;
    return and(
      scope(tx, v),
      !v.family && f.view ? this.view(v, f.view, now) : undefined,
      f.state === "open" ? inArray(requests.state, [...OPEN_STATES]) : f.state ? eq(requests.state, f.state as RequestState) : undefined,
      f.category ? eq(requests.categoryId, f.category) : undefined,
      term ? or(ilike(requests.number, term), ilike(messageThreads.subject, term), ilike(students.name, term), ilike(requests.raisedByName, term), ilike(requestCategories.name, term)) : undefined,
    );
  }

  protected select(tx: Tx) {
    const owner = alias(users, "owner");
    return tx.select({ r: requests, subject: messageThreads.subject, category: requestCategories.name, nature: requestCategories.nature, student: students.name, className: classes.name, section: sections.name, owner: owner.name })
      .from(requests).innerJoin(messageThreads, eq(messageThreads.id, requests.threadId)).innerJoin(requestCategories, eq(requestCategories.id, requests.categoryId))
      .leftJoin(students, eq(students.id, requests.studentId)).leftJoin(sections, eq(sections.id, students.sectionId)).leftJoin(classes, eq(classes.id, students.classId)).leftJoin(owner, eq(owner.id, requests.ownerId));
  }

  private row(x: Awaited<ReturnType<RequestReads["select"]>>[number] | { r: Req; subject: string; category: string; nature: string; student: string | null; className: string | null; section: string | null; owner: string | null }, v: Viewer, now: Date): RequestRow {
    const { r } = x;
    return {
      id: r.id, number: r.number, subject: x.subject, state: r.state, categoryName: x.category, nature: v.family ? "general" : x.nature, studentName: x.student,
      className: x.className ? `${x.className}${x.section ? ` ${x.section}` : ""}` : null, raisedByName: r.raisedByName, ownerName: v.family ? null : x.owner,
      level: r.level, dueAt: r.dueAt, paused: !!r.pausedAt, overdue: isOverdue(r, now), ageDays: Math.floor((now.getTime() - r.createdAt.getTime()) / DAY), createdAt: r.createdAt, resolvedAt: r.resolvedAt,
    };
  }

  /** The queue. `filters.view` is one of mine, unassigned, team, overdue, all; `q` searches number, title, child, who raised it and category. */
  async list(query: ListQuery = {}): Promise<Page<RequestRow>> {
    const q = listQuerySchema.parse({ pageSize: PAGE_SIZE, ...query });
    return this.read("use", async (tx) => {
      const v = await viewerOf(tx, this.ctx), now = new Date();
      const where = this.filtered(tx, v, q, now);
      const closed = sql`case when ${requests.state} in ('resolved', 'closed') then 1 else 0 end`;
      const [rows, [total]] = await Promise.all([
        this.select(tx).where(where).orderBy(...(v.family ? [desc(requests.createdAt)] : [asc(closed), asc(requests.dueAt)]), asc(requests.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(requests).innerJoin(messageThreads, eq(messageThreads.id, requests.threadId)).innerJoin(requestCategories, eq(requestCategories.id, requests.categoryId))
          .leftJoin(students, eq(students.id, requests.studentId)).where(where),
      ]);
      return toPage(rows.map((x) => this.row(x, v, now)), Number(total?.n ?? 0), q);
    });
  }

  /** Unread messages in my requests (the Requests badge). Requests are never in the Messages count, so no message is counted twice. */
  async unreadCount(): Promise<number> {
    return this.read("use", async (tx) => [...(await unreadByThread(tx, this.ctx, undefined, true)).values()].reduce((a, b) => a + b, 0));
  }

  /** How many are in each saved view, for the tabs. Same visibility as the list. */
  async counts(): Promise<Record<ViewKey, number>> {
    return this.read("use", async (tx) => {
      const v = await viewerOf(tx, this.ctx), now = new Date();
      const n = (key: ViewKey) => sql<number>`count(*) filter (where ${this.view(v, key, now) ?? sql`true`})::int`;
      const [r] = await tx.select({ mine: n("mine"), unassigned: n("unassigned"), team: n("team"), overdue: n("overdue"), all: n("all") }).from(requests).where(scope(tx, v));
      return { mine: Number(r?.mine ?? 0), unassigned: Number(r?.unassigned ?? 0), team: Number(r?.team ?? 0), overdue: Number(r?.overdue ?? 0), all: Number(r?.all ?? 0) };
    });
  }

  /** The whole request as this person may see it, with what they can do next. Opening it marks its notifications and messages seen. */
  async get(id: string): Promise<RequestView> {
    const load = async (tx: Tx, mark: boolean): Promise<RequestView> => {
      const { v, r, cat } = await this.load(tx, id);
      const now = new Date();
      const [x] = await this.select(tx).where(eq(requests.id, r.id));
      const [member] = await tx.select({ id: threadMembers.id }).from(threadMembers).where(and(eq(threadMembers.threadId, r.threadId), eq(threadMembers.userId, this.ctx.userId), eq(threadMembers.state, "active")));
      // Office readers who are not in the conversation read it through a logged-in office viewer, never as a member.
      const thread = await loadThread(tx, r.threadId, member ? this.ctx : { schoolId: this.ctx.schoolId, userId: this.ctx.userId, role: this.ctx.role, review: true });
      if (mark) {
        // The bell row of the request clears only once the conversation is fully read, so the Requests badge and the bell agree.
        const caughtUp = member ? await markThreadRead(tx, this.ctx, r.threadId, thread.newestAt) : true;
        if (caughtUp) await NotificationWriter.seen(tx, this.ctx.schoolId, { type: "request", id: r.id }, this.ctx);
      }
      const settings = await loadCommSettings(tx);
      const events = await tx.select().from(requestEvents).where(eq(requestEvents.requestId, r.id)).orderBy(asc(requestEvents.createdAt), asc(requestEvents.id));
      const [into] = r.mergedIntoId ? await tx.select({ id: requests.id, number: requests.number }).from(requests).where(eq(requests.id, r.mergedIntoId)) : [];
      const levels: EscalationLevel[] = cat.escalation;
      const named = r.aboutUserIds.length ? await tx.select({ name: users.name }).from(users).where(inArray(users.id, r.aboutUserIds)) : [];
      const unstaffed = r.aboutUserIds.length > 0 && !(await leadIds(tx, r.aboutUserIds)).length && !(await officeIds(tx, r.aboutUserIds)).length;
      return {
        ...this.row(x!, v, now),
        categoryId: r.categoryId, studentId: r.studentId, raisedBy: r.raisedBy, ownerId: r.ownerId, ownerRole: r.ownerRole,
        answers: answersOf(cat.fields, r.values), linked: r.linked ?? null, firstAnswerAt: r.firstAnswerAt, closedAt: r.closedAt, reopenedCount: r.reopenedCount,
        solved: r.solved, feedback: r.feedback, mergedInto: into ?? null, nextLevel: levels[r.level]?.label ?? null, levelName: r.level > 0 ? levels[r.level - 1]?.label ?? null : null, about: named.map((n) => n.name), thread, needsOutsideHelp: unstaffed,
        safetyContacts: unstaffed || v.family ? settings.safetyContacts : [],
        timeline: events.filter((e) => !v.family || (FAMILY_EVENTS as readonly string[]).includes(e.action)).map((e) => ({
          id: e.id, at: e.createdAt, action: e.action, by: v.family && e.byUserId !== this.ctx.userId ? settings.officeName : e.byName,
          text: e.detail ?? WORDS[e.action] ?? e.action,
        })),
        can: canDo({ v, r, levels, familyInWindow: familyMayReopen(r.resolvedAt ?? r.closedAt ?? now, now) }),
      };
    };
    // A read-only school can still read; it just cannot record that it did.
    return this.ctx.readOnly ? this.read("use", (tx) => load(tx, false)) : this.write("use", (tx) => load(tx, true));
  }

  /** The stored key and name of a file in this request's conversation, if this person may see the message it is in. */
  private async openable(tx: Tx, requestId: string, fileId: string): Promise<{ key: string; name: string; type: string }> {
    const { v, r } = await this.load(tx, requestId);
    if (!z.uuid().safeParse(fileId).success) throw new NotFoundError("File");
    const [f] = await tx.select({ key: messageFiles.fileKey, name: messageFiles.fileName, type: messageFiles.contentType }).from(messageFiles).innerJoin(messages, eq(messages.id, messageFiles.messageId))
      .where(and(eq(messageFiles.id, fileId), eq(messages.threadId, r.threadId), isNull(messages.removedAt), v.family ? eq(messages.internal, false) : undefined));
    if (!f) throw new NotFoundError("File");
    return f;
  }

  /** A 60-second link to a file, for callers that hand the link on (the mobile API). */
  async fileLink(requestId: string, fileId: string): Promise<string> {
    return this.read("use", async (tx) => signedLink((await this.openable(tx, requestId, fileId)).key, LINK_SECONDS));
  }

  /** The file itself, for the module's own route, which sets the download headers. */
  async file(requestId: string, fileId: string): Promise<StoredBytes> {
    return this.read("use", async (tx) => { const f = await this.openable(tx, requestId, fileId); return { bytes: await readStored(f.key), name: f.name, type: f.type }; });
  }
}

function answersOf(fields: RequestField[], values: Record<string, string>) {
  return fields.filter((f) => values[f.id]).map((f) => ({ label: f.label, value: values[f.id]! }));
}
