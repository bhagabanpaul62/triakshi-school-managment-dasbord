import { and, count, desc, eq, ilike } from "drizzle-orm";
import { supportMessages, supportTickets, users, type Tx } from "@smw/db";
import { ConflictError, NotFoundError, SchoolService, listQuerySchema, toPage, type Ctx, type ListQuery, type Page } from "@smw/feature-kit";
import { z } from "zod";
import supportFeature from "./feature";
import { replyInput, ticketInput } from "./inputs";

type Perm = keyof typeof supportFeature.permissions;
export type Ticket = typeof supportTickets.$inferSelect;
export interface ThreadMessage { id: string; body: string; createdAt: Date; fromStaff: boolean; author: string }

/** The school's side of support: raise a ticket, follow the thread, reply, close. Staff replies come from the console. */
export class SupportService extends SchoolService<Perm> {
  protected feature = supportFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Own school's tickets, newest activity first. Filter: `status`. */
  async list(query: ListQuery = {}): Promise<Page<Ticket>> {
    const q = listQuerySchema.parse(query);
    return this.read("use", async (tx) => {
      const where = and(
        q.q ? ilike(supportTickets.subject, `%${q.q}%`) : undefined,
        q.filters.status ? eq(supportTickets.status, q.filters.status as Ticket["status"]) : undefined,
      );
      const [rows, total] = await Promise.all([
        tx.select().from(supportTickets).where(where).orderBy(desc(supportTickets.lastMessageAt), supportTickets.id).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(supportTickets).where(where),
      ]);
      return toPage(rows, Number(total[0]?.n ?? 0), q);
    });
  }

  async thread(ticketId: string): Promise<{ ticket: Ticket; messages: ThreadMessage[] }> {
    return this.read("use", async (tx) => {
      const ticket = await this.find(tx, ticketId);
      const rows = await tx.select({ m: supportMessages, userName: users.name }).from(supportMessages)
        .leftJoin(users, eq(users.id, supportMessages.authorUserId)).where(eq(supportMessages.ticketId, ticket.id)).orderBy(supportMessages.createdAt, supportMessages.id);
      return {
        ticket,
        messages: rows.map(({ m, userName }) => ({
          id: m.id, body: m.body, createdAt: m.createdAt, fromStaff: !!m.authorStaffId, author: m.authorStaffId ? "Triakshi support" : (userName ?? "School user"),
        })),
      };
    });
  }

  /** New ticket with its first message. */
  async create(input: unknown): Promise<Ticket> {
    this.authorize("use", "write");
    const d = this.parse(ticketInput, input);
    return this.write("use", async (tx) => {
      const [t] = await tx.insert(supportTickets).values({ schoolId: this.ctx.schoolId, subject: d.subject, priority: d.priority, createdByUserId: this.ctx.userId }).returning();
      await tx.insert(supportMessages).values({ schoolId: this.ctx.schoolId, ticketId: t!.id, authorUserId: this.ctx.userId, body: d.body });
      return t!;
    }, (t) => ({ action: "create", entity: "Ticket", entityId: t.id, summary: `Raised support ticket "${t.subject}"` }));
  }

  /** Add a message. A resolved or waiting ticket goes back to `open` for the team. */
  async reply(ticketId: string, input: unknown): Promise<void> {
    this.authorize("use", "write");
    const d = this.parse(replyInput, input);
    await this.write("use", async (tx) => {
      const t = await this.find(tx, ticketId);
      if (t.status === "closed") throw new ConflictError("This ticket is closed. Raise a new one.");
      await tx.insert(supportMessages).values({ schoolId: this.ctx.schoolId, ticketId: t.id, authorUserId: this.ctx.userId, body: d.body });
      await tx.update(supportTickets).set({ status: "open", lastMessageAt: new Date(), updatedAt: new Date() }).where(eq(supportTickets.id, t.id));
      return t;
    }, (t) => ({ action: "reply", entity: "Ticket", entityId: t.id, summary: `Replied on ticket "${t.subject}"` }));
  }

  async close(ticketId: string): Promise<void> {
    await this.write("use", async (tx) => {
      const t = await this.find(tx, ticketId);
      await tx.update(supportTickets).set({ status: "closed", updatedAt: new Date() }).where(eq(supportTickets.id, t.id));
      return t;
    }, (t) => ({ action: "close", entity: "Ticket", entityId: t.id, summary: `Closed ticket "${t.subject}"` }));
  }

  private async find(tx: Tx, id: string): Promise<Ticket> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Ticket");
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1);
    if (!t) throw new NotFoundError("Ticket");
    return t;
  }
}
