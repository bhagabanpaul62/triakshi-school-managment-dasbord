import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { events } from "./schema";

/** The events whose consent notice is `href` (an app path), so the notice can link back to its trip. Published and cancelled ones; drafts stay private. */
export async function eventsForConsent(tx: Tx, href: string): Promise<{ id: string; title: string; startsAt: Date; cancelled: boolean; href: string }[]> {
  const rows = await tx.select({ id: events.id, title: events.title, startsAt: events.startsAt, state: events.state }).from(events)
    .where(and(eq(events.consentHref, href), inArray(events.state, ["live", "cancelled"]))).orderBy(asc(events.startsAt), asc(events.id));
  return rows.map((r) => ({ id: r.id, title: r.title, startsAt: r.startsAt, cancelled: r.state === "cancelled", href: `/app/events/${r.id}` }));
}
