import { and, asc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { CrudService, f, ForbiddenError, ValidationError, type Ctx } from "@smw/feature-kit";
import type { Tx } from "@smw/db";
import { students } from "@smw/feature-students/schema";
import eventsFeature from "./feature";
import { addDays, allDaySpan, monthRange, parseIst } from "./dates";
import { eventInput } from "./inputs";
import { events } from "./schema";

type Perm = keyof typeof eventsFeature.permissions;
export type SchoolEvent = typeof events.$inferSelect;

/** The last moment an event is on: its end, or its start when it has none. */
const endOf = sql<Date>`coalesce(${events.endsAt}, ${events.startsAt})`;

/** School events and holidays. Staff see everything; students (the family login) see what is addressed to them, plus every holiday. */
export class EventService extends CrudService<typeof events, Perm> {
  protected feature = eventsFeature;
  protected table = events;
  protected entityName = "Event";
  protected readPermission = "read" as const;
  protected writePermission = "write" as const;
  protected createSchema = eventInput;
  protected updateSchema = eventInput;
  protected defaultSort = "startsAt";

  constructor(ctx: Ctx) { super(ctx); }

  protected searchColumns() { return [events.title, events.location, events.description]; }
  protected sortColumns() { return { startsAt: events.startsAt, title: events.title }; }
  protected filterClauses(filters: Record<string, string | undefined>) {
    return [
      filters.audience ? eq(events.audience, filters.audience as SchoolEvent["audience"]) : undefined,
      filters.kind ? eq(events.isHoliday, filters.kind === "holiday") : undefined,
      filters.when === "upcoming" ? gte(endOf, sql`now()`) : filters.when === "past" ? lt(endOf, sql`now()`) : undefined,
    ];
  }

  protected async scopeClause(tx: Tx): Promise<SQL | undefined> {
    if (this.ctx.role !== "student") return undefined;
    // "parents" means families, who sign in as the student. A class event reaches only that class's students.
    const myClasses = tx.select({ c: students.classId }).from(students).where(and(eq(students.userId, this.ctx.userId), eq(students.status, "active")));
    return or(inArray(events.audience, ["all", "students", "parents"]), eq(events.isHoliday, true), and(eq(events.audience, "class"), inArray(events.classId, myClasses)));
  }

  /** Holidays are all-day by definition; all-day events cover whole days; only class events keep a class. */
  private shape(data: Record<string, unknown>, was?: SchoolEvent) {
    if (data.isPublic && data.audience !== "all") throw new ValidationError({ isPublic: "Only an event for everyone can go on the website" });
    if (this.ctx.role !== "admin") {
      if (data.isPublic && !was?.isPublic) throw new ValidationError({ isPublic: "Only an admin can put an event on the website" });
      if (data.isHoliday && !was?.isHoliday) throw new ValidationError({ isHoliday: "Only an admin can declare a holiday" });
    }
    const allDay = Boolean(data.allDay || data.isHoliday);
    const span = allDay ? allDaySpan(data.startsAt as Date, data.endsAt as Date | undefined) : { startsAt: data.startsAt, endsAt: data.endsAt ?? null };
    return { ...data, ...span, allDay, classId: data.audience === "class" ? data.classId : null };
  }
  protected async beforeCreate(_tx: Tx, data: Record<string, unknown>) { return { ...this.shape(data), createdBy: this.ctx.userId }; }
  /** Admins look after every event; anyone else only their own. */
  private own(row: SchoolEvent) {
    if (this.ctx.role !== "admin" && row.createdBy !== this.ctx.userId) throw new ForbiddenError("Only the person who added this event, or an admin, can change it.");
  }
  protected async beforeUpdate(_tx: Tx, existing: SchoolEvent, data: Record<string, unknown>) { this.own(existing); return this.shape(data, existing); }
  protected async beforeRemove(_tx: Tx, existing: SchoolEvent) { this.own(existing); }

  /** Classes to pick from when an audience is "one class". Raw SQL: this feature does not require academics. */
  async classOptions() {
    return this.read("read", async (tx) => [...await tx.execute<{ value: string; label: string }>(sql`select id as value, name as label from classes order by display_order, name`)]);
  }

  /** One scoped, time-ordered read. `where` narrows it; the caller's audience scope is always applied. */
  private async between(where: SQL | undefined, limit?: number) {
    return this.read("read", async (tx) => {
      const q = tx.select().from(events).where(and(await this.scopeClause(tx), where)).orderBy(asc(events.startsAt), asc(events.id));
      return limit ? q.limit(limit) : q;
    });
  }
  // endOf is raw SQL, so drizzle cannot encode a Date for it: pass ISO strings.
  private overlapping(from: Date, to: Date) { return and(lt(events.startsAt, to), gte(endOf, from.toISOString())); }

  /** What is coming next (running now or later), soonest first. For dashboards. */
  async upcoming(limit = 5) {
    return this.between(gte(endOf, sql`now()`), limit);
  }

  /** Every event touching a "YYYY-MM" month, for the calendar grid. */
  async month(yyyymm: string) {
    const ym = this.parse(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month"), yyyymm);
    const { from, to } = monthRange(ym);
    return this.between(this.overlapping(from, to));
  }

  /** Holidays touching [from, to] (inclusive "YYYY-MM-DD"). Attendance and timetable read this. */
  async holidays(from: string, to: string) {
    const start = parseIst(this.parse(f.date(), from)), end = parseIst(addDays(this.parse(f.date(), to), 1));
    if (!start || !end) return [];
    return this.between(and(eq(events.isHoliday, true), this.overlapping(start, end)));
  }

  /** Public events for the school website (no login). Call with a system context. */
  async publicEvents(limit = 6) {
    return this.between(and(eq(events.isPublic, true), eq(events.audience, "all"), gte(endOf, sql`now()`)), limit);
  }
}
