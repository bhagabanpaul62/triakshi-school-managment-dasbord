import { and, count, desc, eq, isNull, platformStaff, schools, supportMessages, supportTickets, users } from "@smw/db";
import { ConflictError, NotFoundError, PlatformService, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { z } from "zod";
import { assertId, oneOf, replyInput } from "./inputs";

export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
type Status = (typeof TICKET_STATUSES)[number];
type Priority = (typeof TICKET_PRIORITIES)[number];

/** Tickets from every school: list, thread, reply, status, priority and owner. */
export class SupportDeskService extends PlatformService {
  /** Filters: `status`, `priority`, `assigned` = `me` | `none`. Open and pending first. */
  async list(query: ListQuery = {}) {
    this.require("owner", "support");
    const q = listQuerySchema.parse(query);
    const status = oneOf(q.filters.status, TICKET_STATUSES), priority = oneOf(q.filters.priority, TICKET_PRIORITIES);
    const where = and(
      status ? eq(supportTickets.status, status) : undefined,
      priority ? eq(supportTickets.priority, priority) : undefined,
      q.filters.assigned === "me" ? eq(supportTickets.assignedStaffId, this.ctx.staffId) : q.filters.assigned === "none" ? isNull(supportTickets.assignedStaffId) : undefined,
      q.filters.school ? eq(supportTickets.schoolId, assertId(q.filters.school, "School")) : undefined,
    );
    return this.tx(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.select({
          id: supportTickets.id, subject: supportTickets.subject, status: supportTickets.status, priority: supportTickets.priority,
          lastMessageAt: supportTickets.lastMessageAt, schoolName: schools.name, schoolId: supportTickets.schoolId, assignee: platformStaff.name,
        }).from(supportTickets).innerJoin(schools, eq(schools.id, supportTickets.schoolId)).leftJoin(platformStaff, eq(platformStaff.id, supportTickets.assignedStaffId))
          .where(where).orderBy(desc(supportTickets.lastMessageAt), supportTickets.id).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(supportTickets).where(where),
      ]);
      return toPage(rows, Number(total[0]?.n ?? 0), q);
    });
  }

  async thread(ticketId: string) {
    this.require("owner", "support");
    return this.tx(async (tx) => {
      assertId(ticketId, "Ticket");
      const [ticket] = await tx.select({ t: supportTickets, schoolName: schools.name, schoolSlug: schools.slug, assignee: platformStaff.name })
        .from(supportTickets).innerJoin(schools, eq(schools.id, supportTickets.schoolId)).leftJoin(platformStaff, eq(platformStaff.id, supportTickets.assignedStaffId))
        .where(eq(supportTickets.id, ticketId)).limit(1);
      if (!ticket) throw new NotFoundError("Ticket");
      const messages = await tx.select({
        id: supportMessages.id, body: supportMessages.body, createdAt: supportMessages.createdAt,
        staffName: platformStaff.name, userName: users.name, fromStaff: supportMessages.authorStaffId,
      }).from(supportMessages).leftJoin(platformStaff, eq(platformStaff.id, supportMessages.authorStaffId)).leftJoin(users, eq(users.id, supportMessages.authorUserId))
        .where(eq(supportMessages.ticketId, ticketId)).orderBy(supportMessages.createdAt, supportMessages.id);
      return { ...ticket, messages };
    });
  }

  /** Staff reply. An open ticket becomes `pending` (waiting on the school); the sender takes it if nobody has. */
  async reply(ticketId: string, input: unknown) {
    this.require("owner", "support");
    const d = this.parse(replyInput, input);
    assertId(ticketId, "Ticket");
    return this.tx(async (tx) => {
      const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
      if (!t) throw new NotFoundError("Ticket");
      if (t.status === "closed") throw new ConflictError("This ticket is closed.");
      await tx.insert(supportMessages).values({ schoolId: t.schoolId, ticketId, authorStaffId: this.ctx.staffId, body: d.body });
      await tx.update(supportTickets).set({
        lastMessageAt: new Date(), status: t.status === "open" ? "pending" : t.status, assignedStaffId: t.assignedStaffId ?? this.ctx.staffId, updatedAt: new Date(),
      }).where(eq(supportTickets.id, ticketId));
      await this.audit(tx, "ticket.reply", `Replied to "${t.subject}"`, t.schoolId, { ticketId });
    });
  }

  async setStatus(ticketId: string, status: Status) {
    this.require("owner", "support");
    const s = this.parse(z.enum(TICKET_STATUSES), status);
    return this.update(ticketId, { status: s }, "ticket.status", `Marked ticket {subject} ${s}`);
  }

  async setPriority(ticketId: string, priority: Priority) {
    this.require("owner", "support");
    const p = this.parse(z.enum(TICKET_PRIORITIES), priority);
    return this.update(ticketId, { priority: p }, "ticket.priority", `Set ticket {subject} to ${p} priority`);
  }

  /** Take the ticket (or hand it to someone with `staffId`; `null` unassigns). */
  async assign(ticketId: string, staffId: string | null = this.ctx.staffId) {
    this.require("owner", "support");
    return this.update(ticketId, { assignedStaffId: staffId }, "ticket.assign", "Assigned ticket {subject}");
  }

  private update(ticketId: string, set: Partial<typeof supportTickets.$inferInsert>, action: string, summary: string) {
    assertId(ticketId, "Ticket");
    if (set.assignedStaffId) assertId(set.assignedStaffId, "Staff member");
    return this.tx(async (tx) => {
      const [t] = await tx.update(supportTickets).set({ ...set, updatedAt: new Date() }).where(eq(supportTickets.id, ticketId)).returning();
      if (!t) throw new NotFoundError("Ticket");
      await this.audit(tx, action, summary.replace("{subject}", `"${t.subject}"`), t.schoolId, { ticketId });
      return t;
    });
  }
}
