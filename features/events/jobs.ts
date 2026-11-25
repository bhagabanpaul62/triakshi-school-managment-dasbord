import { and, eq, gt, lte, sql } from "drizzle-orm";
import { schools, withConsole, withSchool, type Tx } from "@smw/db";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { reminderWords } from "./constants";
import { lateJoiners } from "./people";
import { eventPeople, events } from "./schema";
import { whenLabel } from "./ui/when";

const MAX_AHEAD_MS = 30 * 86_400_000;

/**
 * Sends the reminders that are due in one school. Each offset of each event goes out once: the update that records it
 * is the claim, so two runs at the same moment cannot both send. People who said no are left out.
 */
export async function remindSchool(tx: Tx, schoolId: string, now = new Date()): Promise<number> {
  const soon = await tx.select().from(events).where(and(eq(events.state, "live"), gt(events.startsAt, now), lte(events.startsAt, new Date(now.getTime() + MAX_AHEAD_MS)), sql`jsonb_array_length(${events.reminders}) > 0`));
  let sent = 0;
  for (const e of soon) {
    const due = e.reminders.filter((m) => !e.remindedFor.includes(m) && e.startsAt.getTime() - m * 60_000 <= now.getTime());
    if (!due.length) continue;
    const claim = JSON.stringify(due);
    const won = await tx.update(events).set({ remindedFor: sql`(select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(${events.remindedFor} || ${claim}::jsonb) x)` })
      .where(and(eq(events.id, e.id), sql`not (${events.remindedFor} @> ${claim}::jsonb)`)).returning({ id: events.id });
    if (!won.length) continue;
    const who = await tx.select({ u: eventPeople.userId }).from(eventPeople).where(and(eq(eventPeople.eventId, e.id), sql`${eventPeople.userId} is not null`, sql`(${eventPeople.answer} is null or ${eventPeople.answer} <> 'no')`));
    sent += await NotificationWriter.insert(tx, schoolId, who.map((w) => ({
      userId: w.u!, topic: "event.reminder" as const, title: `${reminderWords(Math.min(...due))}: ${e.title}`,
      body: `${whenLabel({ startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null, allDay: e.allDay })}${e.location ? `, ${e.location}` : ""}`,
      href: `/app/events/${e.id}`, subject: { type: "event", id: e.id },
    })));
  }
  return sent;
}

/** Runs `work` in every active school; one school failing does not stop the rest, and the run still fails at the end. */
async function eachSchool(what: string, work: (tx: Tx, schoolId: string) => Promise<unknown>) {
  const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
  let failed = 0;
  for (const id of ids) {
    try { await withSchool(id, (tx) => work(tx, id)); }
    catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: `${what} failed`, schoolId: id, err: String(err) })); }
  }
  if (failed) throw new Error(`${what} failed for ${failed} of ${ids.length} schools`);
}

export default {
  /** Every 5 minutes (the orchestrator adds the schedule). */
  "events.reminders": () => eachSchool("Event reminders", (tx, id) => remindSchool(tx, id)),
  /** Daily: new people join the events of their class without a notice; people who left drop out. */
  "events.late-joiners": () => eachSchool("Event late joiners", (tx, id) => lateJoiners(tx, id)),
} satisfies Record<string, () => Promise<unknown>>;
