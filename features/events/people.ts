// Who an event is for, frozen when it goes live (event_people). One place for freezing, re-syncing and telling people.
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { chunks } from "@smw/feature-notifications/constants";
import { resolveAudience } from "@smw/feature-notifications/audience";
import { personKey, type Audience, type Reached } from "@smw/feature-notifications/audience-rules";
import type { TopicKey } from "@smw/feature-notifications/topics";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { eventPeople, events } from "./schema";

const row = (schoolId: string, eventId: string, r: Reached) => ({ schoolId, eventId, personKey: personKey(r), userId: r.userId, studentId: r.studentId, name: r.name, label: r.label });

/**
 * Freeze the audience into the first event, then copy that list to the others with one INSERT ... SELECT each
 * (a series of 60 never walks 10,000 people 60 times). Returns who was reached.
 */
export async function freezePeople(tx: Tx, schoolId: string, eventIds: string[], audience: Audience): Promise<Reached[]> {
  const reached = await resolveAudience(tx, audience);
  const [first, ...rest] = eventIds;
  if (!first) return reached;
  for (const part of chunks(reached)) await tx.insert(eventPeople).values(part.map((r) => row(schoolId, first, r))).onConflictDoNothing();
  for (const id of rest) {
    await tx.execute(sql`insert into event_people (id, school_id, event_id, person_key, user_id, student_id, name, label)
      select gen_random_uuid(), school_id, ${id}::uuid, person_key, user_id, student_id, name, label from event_people where event_id = ${first}::uuid on conflict do nothing`);
  }
  return reached;
}

/** The audience changed: people no longer in it lose the event (and their answer), new people are added. Returns the added ones. */
export async function syncPeople(tx: Tx, schoolId: string, eventIds: string[], audience: Audience): Promise<Reached[]> {
  const reached = await resolveAudience(tx, audience);
  const keys = reached.map(personKey);
  const have = new Set((await tx.select({ k: eventPeople.personKey }).from(eventPeople).where(eq(eventPeople.eventId, eventIds[0]!))).map((r) => r.k));
  await tx.delete(eventPeople).where(and(inArray(eventPeople.eventId, eventIds), sql`${eventPeople.personKey} <> all(${sql.param(keys)}::text[])`));
  for (const id of eventIds) for (const part of chunks(reached)) await tx.insert(eventPeople).values(part.map((r) => row(schoolId, id, r))).onConflictDoNothing();
  return reached.filter((r) => !have.has(personKey(r)));
}

/** One notification per person, whatever number of events they are in. The person who made the change is not told. */
export interface Tell { topic: TopicKey; title: string; body?: string; href: string; subject: { type: "event"; id: string }; groupKey?: string }
export function tell(tx: Tx, schoolId: string, userIds: (string | null)[], skip: string, what: Tell) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u && u !== skip))];
  return NotificationWriter.insert(tx, schoolId, ids.map((userId) => ({ userId, ...what })));
}

/** Logins of everyone frozen into any of these events. */
export async function peopleOf(tx: Tx, eventIds: string[]): Promise<string[]> {
  return (await tx.selectDistinct({ u: eventPeople.userId }).from(eventPeople).where(inArray(eventPeople.eventId, eventIds))).map((r) => r.u).filter((u): u is string => !!u);
}

/**
 * Nightly, for live events that have not ended: people now in the audience who are not on the list are added silently
 * (new student, new teacher), and people who left (student not active, login off) are taken off unless they answered.
 * Answered rows stay for the count; the events visibility rule hides the event from a student who is not active.
 */
export async function lateJoiners(tx: Tx, schoolId: string, now = new Date()): Promise<{ added: number; removed: number }> {
  const open = await tx.select({ id: events.id, audience: events.audience }).from(events)
    .where(and(eq(events.state, "live"), gte(sql`coalesce(${events.endsAt}, ${events.startsAt})`, sql`${now.toISOString()}::timestamptz`)));
  const byAudience = new Map<string, { audience: Audience; ids: string[] }>();
  for (const e of open) {
    const k = JSON.stringify(e.audience);
    (byAudience.get(k) ?? byAudience.set(k, { audience: e.audience, ids: [] }).get(k)!).ids.push(e.id);
  }
  let added = 0;
  for (const { audience, ids } of byAudience.values()) {
    const reached = await resolveAudience(tx, audience);
    for (const id of ids) for (const part of chunks(reached)) {
      added += (await tx.insert(eventPeople).values(part.map((r) => row(schoolId, id, r))).onConflictDoNothing().returning({ id: eventPeople.id })).length;
    }
  }
  const gone = open.length ? await tx.delete(eventPeople).where(and(inArray(eventPeople.eventId, open.map((e) => e.id)), sql`${eventPeople.answer} is null`,
    sql`((${eventPeople.studentId} is not null and exists (select 1 from students s where s.id = ${eventPeople.studentId} and s.status <> 'active'))
      or (${eventPeople.userId} is not null and exists (select 1 from users u where u.id = ${eventPeople.userId} and u.status <> 'active')))`)).returning({ id: eventPeople.id }) : [];
  return { added, removed: gone.length };
}
