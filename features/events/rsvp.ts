import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { SchoolService, ConflictError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import type { Tx } from "@smw/db";
import { csvText, slugOf } from "@smw/integrations";
import { resolveAudience } from "@smw/feature-notifications/audience";
import { isEveryone, personKey } from "@smw/feature-notifications/audience-rules";
import { canRun, mustRun, noSupport } from "./access";
import type { RsvpAnswer, RsvpSpec } from "./constants";
import { whenLabel } from "./ui/when";
import eventsFeature from "./feature";
import { answerInput } from "./inputs";
import { tell } from "./people";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { eventPeople, events } from "./schema";

type Perm = keyof typeof eventsFeature.permissions;
type EventRow = typeof events.$inferSelect;
type Person = typeof eventPeople.$inferSelect;

export interface RsvpCounts { invited: number; going: number; waiting: number; maybe: number; no: number; noReply: number; seats: number; guests: number; checkedIn: number }

/** People who still count: a staff member, or a student who is still at the school. A left student holds no seat. */
const present = sql`(student_id is null or exists (select 1 from students s where s.id = event_people.student_id and s.status = 'active'))`;

export async function rsvpCounts(tx: Tx, eventId: string): Promise<RsvpCounts> {
  const [r] = [...(await tx.execute(sql`select count(*)::int as invited,
    count(*) filter (where answer = 'yes' and waiting_since is null)::int as going,
    count(*) filter (where answer = 'yes' and waiting_since is not null)::int as waiting,
    count(*) filter (where answer = 'maybe')::int as maybe, count(*) filter (where answer = 'no')::int as no, count(*) filter (where answer is null)::int as "noReply",
    coalesce(sum(1 + guests) filter (where answer = 'yes' and waiting_since is null), 0)::int as seats,
    coalesce(sum(guests) filter (where answer in ('yes', 'maybe')), 0)::int as guests, count(*) filter (where checked_in_at is not null)::int as "checkedIn"
    from event_people where event_id = ${eventId}::uuid and ${present}`))] as unknown as RsvpCounts[];
  return r!;
}

/** Waiting people move up, oldest first, as long as their whole party fits. They are told. */
export async function promoteWaiting(tx: Tx, schoolId: string, e: Pick<EventRow, "id" | "title" | "rsvp" | "startsAt" | "endsAt" | "allDay" | "location">, actorId: string): Promise<number> {
  if (!e.rsvp.on) return 0;
  const waiting = await tx.select().from(eventPeople).where(and(eq(eventPeople.eventId, e.id), eq(eventPeople.answer, "yes"), isNotNull(eventPeople.waitingSince), present)).orderBy(asc(eventPeople.waitingSince), asc(eventPeople.id));
  if (!waiting.length) return 0;
  let free = e.rsvp.capacity === undefined ? Infinity : e.rsvp.capacity - (await rsvpCounts(tx, e.id)).seats;
  const moved = waiting.filter((w) => { const need = 1 + w.guests; if (need > free) return false; free -= need; return true; });
  for (const w of moved) await tx.update(eventPeople).set({ waitingSince: null }).where(eq(eventPeople.id, w.id));
  await tell(tx, schoolId, moved.map((w) => w.userId), actorId, { topic: "event.changed", title: `A place is yours: ${e.title}`, body: whenLabel({ startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null, allDay: e.allDay }), href: `/app/events/${e.id}`, subject: { type: "event", id: e.id } });
  return moved.length;
}

export type AnswerStatus = "going" | "waiting" | "maybe" | "not_going";

/** Answers (yes, maybe, no), guests, capacity with a waiting list, check-in and the staff list. */
export class RsvpService extends SchoolService<Perm> {
  protected feature = eventsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** The event row, locked so parallel answers line up one behind the other. */
  private async lock(tx: Tx, id: string): Promise<EventRow> {
    const [e] = await tx.select().from(events).where(eq(events.id, id)).for("update");
    if (!e || e.state === "draft" && !canRun(this.ctx, e)) throw new NotFoundError("Event");
    return e;
  }

  /** The caller's own place in the list. An event for everyone adds a person who joined after it went live. */
  private async self(tx: Tx, e: EventRow): Promise<Person> {
    const [p] = await tx.select().from(eventPeople).where(and(eq(eventPeople.eventId, e.id), eq(eventPeople.userId, this.ctx.userId))).limit(1);
    if (p) return p;
    if (e.state !== "draft" && isEveryone(e.audience)) {
      const mine = (await resolveAudience(tx, e.audience)).filter((r) => r.userId === this.ctx.userId);
      if (mine.length) {
        const [created] = await tx.insert(eventPeople).values(mine.map((r) => ({ schoolId: this.ctx.schoolId, eventId: e.id, personKey: personKey(r), userId: r.userId, studentId: r.studentId, name: r.name, label: r.label }))).onConflictDoNothing().returning();
        if (created) return created;
        const [again] = await tx.select().from(eventPeople).where(and(eq(eventPeople.eventId, e.id), eq(eventPeople.userId, this.ctx.userId))).limit(1);
        if (again) return again;
      }
    }
    throw new NotFoundError("Event");
  }

  private async apply(tx: Tx, e: EventRow, p: Person, input: { answer: RsvpAnswer; guests: number }): Promise<AnswerStatus> {
    const spec: RsvpSpec = e.rsvp;
    if (!spec.on) throw new ConflictError("This event does not ask for answers.");
    if (e.state === "cancelled") throw new ConflictError("This event is cancelled.");
    if (p.studentId && !(await tx.execute(sql`select 1 from students where id = ${p.studentId}::uuid and status = 'active'`)).length) throw new ConflictError(`${p.name} is no longer at the school, so this cannot be answered.`);
    if ((e.endsAt ?? e.startsAt) < new Date()) throw new ConflictError("This event is over.");
    const guests = input.answer === "no" ? 0 : input.guests;
    if (guests > (spec.guests ?? 0)) throw new ValidationError({ guests: spec.guests ? `You can bring up to ${spec.guests} guests.` : "Guests are not invited to this event." });
    const had = p.answer === "yes" && !p.waitingSince;
    let waitingSince: Date | null = null;
    if (input.answer === "yes" && spec.capacity !== undefined) {
      const taken = (await rsvpCounts(tx, e.id)).seats - (had ? 1 + p.guests : 0);
      if (taken + 1 + guests > spec.capacity) {
        if (had) throw new ConflictError(`Only ${Math.max(0, spec.capacity - taken - 1)} more places are left, so you cannot add more guests.`);
        waitingSince = p.waitingSince ?? new Date();
      }
    }
    await tx.update(eventPeople).set({ answer: input.answer, guests, answeredAt: new Date(), waitingSince }).where(eq(eventPeople.id, p.id));
    // Any answer settles the invitation's "answer" action for that person.
    if (p.userId) await NotificationWriter.done(tx, this.ctx.schoolId, { type: "event", id: e.id }, p.userId);
    await promoteWaiting(tx, this.ctx.schoolId, e, this.ctx.userId);
    if (input.answer === "no") return "not_going";
    if (input.answer === "maybe") return "maybe";
    const [now] = await tx.select({ w: eventPeople.waitingSince }).from(eventPeople).where(eq(eventPeople.id, p.id));
    return now?.w ? "waiting" : "going";
  }

  /** The caller answers for themselves. */
  async answer(eventId: string, input: unknown): Promise<AnswerStatus> {
    noSupport(this.ctx);
    const data = this.parse(answerInput, input);
    return this.write("read", async (tx) => {
      const e = await this.lock(tx, eventId);
      if (e.rsvp.closesAt && new Date(e.rsvp.closesAt) <= new Date()) throw new ConflictError("Answers for this event are closed.");
      return this.apply(tx, e, await this.self(tx, e), data);
    }, () => ({ action: "rsvp", entity: "Event", entityId: eventId, summary: "Answered an event" }));
  }

  private async person(tx: Tx, e: EventRow, key: string): Promise<Person> {
    const [p] = await tx.select().from(eventPeople).where(and(eq(eventPeople.eventId, e.id), eq(eventPeople.personKey, key))).limit(1);
    if (!p) throw new NotFoundError("Person");
    return p;
  }

  /** The owner or the office answers for someone who has no phone. */
  async answerFor(eventId: string, key: string, input: unknown): Promise<AnswerStatus> {
    noSupport(this.ctx);
    const data = this.parse(answerInput, input);
    return this.write("write", async (tx) => {
      const e = await this.lock(tx, eventId);
      mustRun(this.ctx, e);
      return this.apply(tx, e, await this.person(tx, e, key), data);
    }, () => ({ action: "rsvp-for", entity: "Event", entityId: eventId, summary: "Answered an event for someone" }));
  }

  /** Mark a person as arrived (or undo it). */
  async checkIn(eventId: string, key: string, on = true): Promise<{ checkedIn: boolean }> {
    noSupport(this.ctx);
    return this.write("write", async (tx) => {
      const e = await this.lock(tx, eventId);
      mustRun(this.ctx, e);
      if (e.state !== "live") throw new ConflictError("Only a live event has a check-in.");
      const p = await this.person(tx, e, key);
      await tx.update(eventPeople).set({ checkedInAt: on ? new Date() : null }).where(eq(eventPeople.id, p.id));
      return { checkedIn: on };
    });
  }

  /** Everyone invited, with their answer. For the owner and the office. */
  async list(eventId: string) {
    noSupport(this.ctx);
    return this.read("write", async (tx) => {
      const [e] = await tx.select().from(events).where(eq(events.id, eventId));
      if (!e) throw new NotFoundError("Event");
      if (!canRun(this.ctx, e)) throw new ForbiddenError("Only the person who added this event, or the office, can see who answered.");
      const rows = await tx.select().from(eventPeople).where(eq(eventPeople.eventId, eventId)).orderBy(asc(eventPeople.name), asc(eventPeople.id));
      return { event: e, rows, counts: await rsvpCounts(tx, eventId) };
    });
  }

  /** The list as CSV. A cell that starts like a formula is made harmless. */
  async csv(eventId: string): Promise<{ name: string; text: string }> {
    const { event, rows } = await this.list(eventId);
    const stamp = (d: Date | null) => (d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "");
    const lines = [["Name", "Class or role", "Answer", "Guests", "On the waiting list", "Answered at", "Arrived at"],
      ...rows.map((p) => [p.name, p.label, p.answer ?? "No answer", p.guests, p.waitingSince ? "Yes" : "", stamp(p.answeredAt), stamp(p.checkedInAt)])];
    return { name: `${slugOf(event.title, "event", 200)}-answers.csv`, text: csvText(lines) };
  }
}
