import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { plans, schools, supportFiles, supportMessages, supportTickets, supportViews, users, withSchool, type Tx } from "@smw/db";
import {
  ConflictError, ForbiddenError, NotFoundError, ReadOnlyError, SchoolService, ValidationError, listQuerySchema, toPage,
  type Ctx, type ListQuery, type Page,
} from "@smw/feature-kit";
import { services } from "@smw/integrations";
import { z } from "zod";
import supportFeature from "./feature";
import { dropKeys, fileHref, LINK_SECONDS, storeAll, type UploadedFile } from "./files";
import { ratingInput, replyInput, ticketInput, voteInput } from "./inputs";
import { articleBySlug } from "./articles";

export type { UploadedFile } from "./files";
type Perm = keyof typeof supportFeature.permissions;
export type Ticket = typeof supportTickets.$inferSelect;
export interface TicketFile { id: string; name: string; contentType: string; size: number; href: string }
export interface ThreadMessage { id: string; body: string; createdAt: Date; fromStaff: boolean; author: string; files: TicketFile[] }
export interface Thread { ticket: Ticket; messages: ThreadMessage[]; planKey: string | null; followUpOf: { id: string; number: number } | null; canAll: boolean }

/** At most this many new tickets in an hour: from one person, and from the whole school. */
export const PERSON_HOURLY_LIMIT = 10;
export const SCHOOL_HOURLY_LIMIT = 60;

/**
 * The school's side of support: raise a ticket, follow the thread, reply, mark solved, reopen, close, rate.
 * Without `support:all` a person sees only the tickets they wrote or wrote in. Staff replies come from the console.
 * A read-only school may still ask for help: tickets are how it gets back to normal.
 */
export class SupportService extends SchoolService<Perm> {
  protected feature = supportFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Run inside the school's scope after a permission check that lets a read-only school through (a support session that is read-only stays out). */
  private run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    this.authorize("use", "read");
    if (this.ctx.readOnly && this.ctx.supportStaffId) throw new ReadOnlyError();
    return withSchool(this.ctx.schoolId, fn);
  }

  /** Tickets this person may see: all of them with `support:all`, else the ones they wrote or wrote in. */
  private scope(): SQL | undefined {
    if (this.can("all")) return undefined;
    return or(
      eq(supportTickets.createdByUserId, this.ctx.userId),
      sql`exists (select 1 from support_messages sm where sm.ticket_id = support_tickets.id and sm.author_user_id = ${this.ctx.userId}::uuid)`,
    );
  }

  /**
   * Tickets, newest activity first. Filters: `status`, `scope` = `mine` (only what I wrote). Search: subject or number (`T-1042`).
   */
  async list(query: ListQuery = {}): Promise<Page<Ticket>> {
    const q = listQuerySchema.parse(query);
    return this.read("use", async (tx) => {
      const num = q.q ? /^t?-?(\d{1,9})$/i.exec(q.q)?.[1] : undefined;
      const where = and(
        this.scope(),
        q.q ? or(ilike(supportTickets.subject, `%${q.q.replace(/[%_\\]/g, "\\$&")}%`), num ? eq(supportTickets.number, Number(num)) : undefined) : undefined,
        q.filters.status && ["open", "pending", "resolved", "closed"].includes(q.filters.status) ? eq(supportTickets.status, q.filters.status as Ticket["status"]) : undefined,
        q.filters.scope === "mine" ? eq(supportTickets.createdByUserId, this.ctx.userId) : undefined,
      );
      const [rows, total] = await Promise.all([
        tx.select().from(supportTickets).where(where).orderBy(desc(supportTickets.lastMessageAt), supportTickets.id).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(supportTickets).where(where),
      ]);
      return toPage(rows, Number(total[0]?.n ?? 0), q);
    });
  }

  /** How many of my tickets wait for my answer. */
  async waiting(): Promise<number> {
    return this.read("use", async (tx) => Number((await tx.select({ n: count() }).from(supportTickets).where(and(this.scope(), eq(supportTickets.status, "pending"))))[0]?.n ?? 0));
  }

  async thread(ticketId: string): Promise<Thread> {
    return this.read("use", async (tx) => {
      const ticket = await this.find(tx, ticketId);
      const rows = await tx.select({ m: supportMessages, userName: users.name }).from(supportMessages)
        .leftJoin(users, eq(users.id, supportMessages.authorUserId)).where(eq(supportMessages.ticketId, ticket.id)).orderBy(supportMessages.createdAt, supportMessages.id);
      const files = await tx.select().from(supportFiles).where(eq(supportFiles.ticketId, ticket.id)).orderBy(supportFiles.createdAt, supportFiles.id);
      const [plan] = await tx.select({ key: plans.key }).from(schools).leftJoin(plans, eq(plans.id, schools.planId)).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      const [prev] = ticket.followUpOf ? await tx.select({ id: supportTickets.id, number: supportTickets.number }).from(supportTickets).where(and(eq(supportTickets.id, ticket.followUpOf), this.scope())) : [];
      return {
        ticket, planKey: plan?.key ?? null, followUpOf: prev ?? null, canAll: this.can("all"),
        messages: rows.map(({ m, userName }) => ({
          id: m.id, body: m.body, createdAt: m.createdAt, fromStaff: !!m.authorStaffId, author: m.authorStaffId ? (m.staffName ? `${m.staffName}, Triakshi support` : "Triakshi support") : (userName ?? "School user"),
          files: files.filter((f) => f.messageId === m.id).map((f) => ({ id: f.id, name: f.fileName, contentType: f.contentType, size: f.size, href: fileHref(f.id) })),
        })),
      };
    });
  }

  /**
   * New ticket with its first message and files. The ticket number, owner and reply time are the database's and the clock's, not ours.
   * Other modules may call it with just `{ subject, body, category, priority, context }`.
   */
  async create(input: unknown, files: UploadedFile[] = []): Promise<Ticket> {
    this.authorize("use", "read");
    if (this.ctx.readOnly && this.ctx.supportStaffId) throw new ReadOnlyError();
    const d = this.parse(ticketInput, input);
    const id = randomUUID();
    const stored = await storeAll(this.ctx.schoolId, id, files);
    try {
      return await withSchool(this.ctx.schoolId, async (tx) => {
        const since = gte(supportTickets.createdAt, new Date(Date.now() - 3_600_000));
        const [mine, all] = await Promise.all([
          tx.select({ n: count() }).from(supportTickets).where(and(since, eq(supportTickets.createdByUserId, this.ctx.userId))),
          tx.select({ n: count() }).from(supportTickets).where(since),
        ]);
        if (Number(mine[0]?.n ?? 0) >= PERSON_HOURLY_LIMIT) throw new ConflictError(`You have sent ${PERSON_HOURLY_LIMIT} tickets in the last hour. Add to one you already sent, or try again in a while.`);
        if (Number(all[0]?.n ?? 0) >= SCHOOL_HOURLY_LIMIT) throw new ConflictError("Your school has sent a lot of tickets in the last hour. Add to one that is already open, or try again in a while.");
        if (d.followUpOf) await this.find(tx, d.followUpOf);
        const [t] = await tx.insert(supportTickets).values({
          id, schoolId: this.ctx.schoolId, subject: d.subject, category: d.category, priority: d.priority, createdByUserId: this.ctx.userId,
          context: d.context, followUpOf: d.followUpOf ?? null,
        }).returning();
        const [m] = await tx.insert(supportMessages).values({ schoolId: this.ctx.schoolId, ticketId: id, authorUserId: this.ctx.userId, body: d.body }).returning({ id: supportMessages.id });
        await this.attach(tx, id, m!.id, stored);
        await this.audit(tx, { action: "create", entity: "Ticket", entityId: id, summary: `Raised support ticket T-${t!.number} "${t!.subject}"` });
        return t!;
      });
    } catch (e) { await dropKeys(stored.map((s) => s.key)); throw e; }
  }

  /** Add a message, with files. A solved or waiting ticket goes back to `open` for the team. A closed one takes no more: write a follow-up. */
  async reply(ticketId: string, input: unknown, files: UploadedFile[] = []): Promise<Ticket> {
    this.authorize("use", "read");
    if (this.ctx.readOnly && this.ctx.supportStaffId) throw new ReadOnlyError();
    const d = this.parse(replyInput, input);
    if (!z.uuid().safeParse(ticketId).success) throw new NotFoundError("Ticket");
    const stored = await storeAll(this.ctx.schoolId, ticketId, files);
    try {
      return await withSchool(this.ctx.schoolId, async (tx) => {
        const t = await this.find(tx, ticketId, true);
        if (t.status === "closed") throw new ConflictError("This ticket is closed. Write a follow-up instead.");
        const [m] = await tx.insert(supportMessages).values({ schoolId: this.ctx.schoolId, ticketId: t.id, authorUserId: this.ctx.userId, body: d.body }).returning({ id: supportMessages.id });
        await this.attach(tx, t.id, m!.id, stored);
        const [u] = await tx.update(supportTickets).set({ status: "open", lastMessageAt: new Date(), updatedAt: new Date() }).where(eq(supportTickets.id, t.id)).returning();
        await this.audit(tx, { action: "reply", entity: "Ticket", entityId: t.id, summary: `Replied on ticket T-${t.number} "${t.subject}"` });
        return u!;
      });
    } catch (e) { await dropKeys(stored.map((s) => s.key)); throw e; }
  }

  /** "This is solved." Needs a ticket that is open or waiting. */
  async solve(ticketId: string): Promise<void> {
    await this.move(ticketId, "solve", (t) => {
      if (t.status === "closed") throw new ConflictError("This ticket is already closed.");
      return t.status === "resolved" ? null : { status: "resolved", resolvedAt: new Date() };
    }, (t) => `Marked ticket T-${t.number} solved`);
  }

  /** "It is not solved." Only a solved ticket comes back; a closed one is followed up. */
  async reopen(ticketId: string): Promise<void> {
    await this.move(ticketId, "reopen", (t) => {
      if (t.status === "closed") throw new ConflictError("A closed ticket stays closed. Write a follow-up and we will pick it up.");
      return t.status === "resolved" ? { status: "open", lastMessageAt: new Date() } : null;
    }, (t) => `Reopened ticket T-${t.number}`);
  }

  async close(ticketId: string): Promise<void> {
    await this.move(ticketId, "close", (t) => (t.status === "closed" ? null : { status: "closed", closedAt: new Date() }), (t) => `Closed ticket T-${t.number} "${t.subject}"`);
  }

  /** A rating of 1 to 5 and a line, once the ticket is solved or closed. Can be changed. */
  async rate(ticketId: string, input: unknown): Promise<void> {
    const d = this.parse(ratingInput, input);
    await this.move(ticketId, "rate", (t) => {
      if (t.status !== "resolved" && t.status !== "closed") throw new ConflictError("You can rate a ticket once it is solved.");
      return { rating: d.rating, ratingNote: d.note ?? null };
    }, (t) => `Rated ticket T-${t.number} ${d.rating} of 5`);
  }

  private async move(ticketId: string, action: string, change: (t: Ticket) => Partial<typeof supportTickets.$inferInsert> | null, summary: (t: Ticket) => string): Promise<void> {
    await this.run(async (tx) => {
      const t = await this.find(tx, ticketId, true);
      const set = change(t);
      if (!set) return;
      await tx.update(supportTickets).set({ ...set, updatedAt: new Date() }).where(eq(supportTickets.id, t.id));
      await this.audit(tx, { action, entity: "Ticket", entityId: t.id, summary: summary(t) });
    });
  }

  /** A 60-second link to a file, after checking the ticket is this person's to see. */
  async fileUrl(fileId: string): Promise<{ url: string; name: string; contentType: string }> {
    const f = await this.locate(fileId);
    return { url: await services().storage.signedUrl(f.fileKey, LINK_SECONDS), name: f.fileName, contentType: f.contentType };
  }

  /** The file itself, for the route that serves it. */
  async fileBytes(fileId: string): Promise<{ bytes: Uint8Array; name: string; contentType: string }> {
    const f = await this.locate(fileId);
    return { bytes: await services().storage.get(f.fileKey), name: f.fileName, contentType: f.contentType };
  }

  private async locate(fileId: string) {
    return this.read("use", async (tx) => {
      if (!z.uuid().safeParse(fileId).success) throw new NotFoundError("File");
      const [f] = await tx.select().from(supportFiles).where(eq(supportFiles.id, fileId)).limit(1);
      if (!f) throw new NotFoundError("File");
      await this.find(tx, f.ticketId);
      return f;
    });
  }

  private async attach(tx: Tx, ticketId: string, messageId: string, stored: { key: string; file: UploadedFile }[]) {
    if (!stored.length) return;
    await tx.insert(supportFiles).values(stored.map(({ key, file }) => ({
      schoolId: this.ctx.schoolId, ticketId, messageId, fileKey: key, fileName: file.name.slice(0, 120), contentType: file.type, size: file.size,
    })));
  }

  private async find(tx: Tx, id: string, lock = false): Promise<Ticket> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Ticket");
    const q = tx.select().from(supportTickets).where(and(eq(supportTickets.id, id), this.scope())).limit(1);
    const [t] = lock ? await q.for("update") : await q;
    if (!t) throw new NotFoundError("Ticket");
    return t;
  }
}

/** Help articles: "Was this useful?". Any signed-in staff member may vote; no person is stored. */
export class HelpService {
  constructor(private readonly ctx: Ctx) {}

  async vote(input: unknown): Promise<void> {
    if (this.ctx.role === "student" || this.ctx.role === "parent") throw new ForbiddenError("Ask your school's office for help.");
    const r = voteInput.safeParse(input);
    if (!r.success || !articleBySlug(r.data.article)) throw new ValidationError({ article: "That article does not exist" });
    await withSchool(this.ctx.schoolId, (tx) => tx.insert(supportViews).values({ schoolId: this.ctx.schoolId, article: r.data.article, useful: r.data.useful }));
  }
}
