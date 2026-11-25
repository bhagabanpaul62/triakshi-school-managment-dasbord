import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { schoolUrl } from "@smw/config";
import { withConsole } from "@smw/db";
import { emailHtml, escapeHtml, services } from "@smw/integrations";
import { apply, emailTarget, failedTry, load, LEASE_MS, NO_BUDGET, releaseMail, reserveMail, tomorrowMorning, unsubscribeHeaders, type EmailTarget } from "./delivery";
import { isAddressRefusal, suppress } from "./email-health";
import { PreferenceService } from "./prefs";
import { commDeliveries, notificationPrefs, type Delivery, type Notification } from "./schema";
import { lockedGroup, TOPIC_GROUPS, topicOf, type TopicGroup } from "./topics";

const MAX_LINES = 15;
const DEFAULT_HOUR = 18;

export interface DigestResult { mails: number; notifications: number; skipped: number; failed: number }

interface Line { row: Delivery; note: Notification; name: string; limited: boolean }

/** One line of the mail. Private words never appear; to an unverified address even the title is held back. */
const lineText = (l: Line, many: boolean) => `${many ? `${l.name}: ` : ""}${l.limited ? `${topicOf(l.note.topic).label} (sign in to read)` : l.note.privateBody ? l.note.title : l.note.body ? `${l.note.title}: ${l.note.body}` : l.note.title}`;

/**
 * Send the digest for people whose chosen hour (8 or 18, default 18) is `hour`: one mail per address, grouped by topic group,
 * leaving out whatever was read. Rows are claimed under a lock before sending (a second run finds nothing), and a failed
 * send hands them back for the next run.
 */
export async function runDigest(o: { hour: number; now?: Date; schoolId?: string }): Promise<DigestResult> {
  const now = o.now ?? new Date();
  const out: DigestResult = { mails: 0, notifications: 0, skipped: 0, failed: 0 };
  const rows = await withConsole(async (tx) => {
    const due = await tx.select({ d: commDeliveries }).from(commDeliveries)
      .leftJoin(notificationPrefs, and(eq(notificationPrefs.schoolId, commDeliveries.schoolId), eq(notificationPrefs.userId, commDeliveries.userId)))
      .where(and(eq(commDeliveries.state, "pending"), eq(commDeliveries.mode, "digest"), eq(commDeliveries.channel, "email"), lte(commDeliveries.nextAt, now),
        sql`coalesce(${notificationPrefs.digestHour}, ${DEFAULT_HOUR}) = ${o.hour}`, o.schoolId ? eq(commDeliveries.schoolId, o.schoolId) : undefined))
      .orderBy(asc(commDeliveries.nextAt)).for("update", { of: commDeliveries, skipLocked: true });
    const list = due.map((r) => r.d);
    if (list.length) await tx.update(commDeliveries).set({ nextAt: new Date(now.getTime() + LEASE_MS) }).where(inArray(commDeliveries.id, list.map((r) => r.id)));
    return list;
  });
  if (!rows.length) return out;
  const b = await load(rows);

  const groups = new Map<string, { schoolId: string; userId: string; target: EmailTarget; lines: Line[] }>();
  for (const row of rows) {
    try {
      const note = row.notificationId ? b.notes.get(row.notificationId) : undefined, person = b.people.get(row.userId);
      const skip = !note ? "The notification no longer exists." : note.readAt || note.doneAt ? "Already read in the app" : !person || person.status !== "active" ? "The account is not active." : null;
      if (skip) { await apply([row.id], { state: "skipped", reason: skip }); out.skipped++; continue; }
      const t = await emailTarget(person!, note!, row);
      if ("patch" in t) { await apply([row.id], t.patch); out.skipped++; continue; }
      const k = `${row.schoolId}\u0001${t.address.toLowerCase()}`;
      const g = groups.get(k) ?? { schoolId: row.schoolId, userId: row.userId, target: t, lines: [] };
      g.lines.push({ row, note: note!, name: person!.name, limited: t.limited });
      groups.set(k, g);
    } catch (err) { await release([row], err, now, out); }
  }

  for (const g of groups.values()) {
    const ids = g.lines.map((l) => l.row.id);
    try {
      if (!(await reserveMail(g.schoolId, 4, now))) { await apply(ids, { state: "pending", nextAt: tomorrowMorning(now), reason: NO_BUDGET }); continue; }
      const school = b.schools.get(g.schoolId)!;
      const base = await withConsole((tx) => PreferenceService.unsubscribeUrlFor(tx, g.schoolId, school.slug, g.userId));
      try {
        await services().email.send({ to: g.target.address, ...compose(school, g.lines, base), headers: unsubscribeHeaders(base) });
        await apply(ids, { state: "sent", address: g.target.address, sentAt: now, reason: null });
        out.mails++; out.notifications += ids.length;
      } catch (err) {
        await releaseMail(g.schoolId, now);
        if (isAddressRefusal(err)) {
          await withConsole((tx) => suppress(tx, g.schoolId, g.target.address, "bounced"));
          await apply(ids, { state: "bounced", address: g.target.address, reason: "The mailbox refused the mail. Correct the address to start again." });
          out.skipped += ids.length;
        } else await release(g.lines.map((l) => l.row), err, now, out);
      }
    } catch (err) { await release(g.lines.map((l) => l.row), err, now, out); }
  }
  return out;
}

/** Hand rows back so the next digest run tries them again; after 5 tries they are marked failed. */
async function release(rows: Delivery[], err: unknown, now: Date, out: DigestResult) {
  for (const row of rows) {
    const p = failedTry(row, err, now);
    // Waiting 1 minute makes no sense for a twice-a-day mail: just come back at the next digest.
    await apply([row.id], p.state === "failed" ? p : { ...p, nextAt: now });
    if (p.state === "failed") out.failed++;
  }
}

function compose(school: { name: string; slug: string }, lines: Line[], unsubscribe: string) {
  const many = new Set(lines.map((l) => l.row.userId)).size > 1;
  const byGroup = new Map<TopicGroup, Line[]>();
  for (const l of lines) byGroup.set(topicOf(l.note.topic).group, [...(byGroup.get(topicOf(l.note.topic).group) ?? []), l]);
  const open = schoolUrl(school.slug, "/app/notifications");
  const sections = [...byGroup].map(([group, ls]) => {
    ls.sort((a, b) => b.note.createdAt.getTime() - a.note.createdAt.getTime());
    const shown = ls.slice(0, MAX_LINES), more = ls.length - shown.length;
    return { label: TOPIC_GROUPS[group], lines: shown.map((l) => lineText(l, many)), more, stop: lockedGroup(group) ? null : `${unsubscribe}${unsubscribe.includes("?") ? "&" : "?"}g=${group}` };
  });
  const n = lines.length;
  const text = [...sections.map((s) => `${s.label}\n${s.lines.map((l) => `- ${l}`).join("\n")}${s.more ? `\n...and ${s.more} more` : ""}${s.stop ? `\nStop these emails: ${s.stop}` : ""}`), `Open everything: ${open}`].join("\n\n");
  const html = emailHtml(`${n} ${n === 1 ? "update" : "updates"} from ${escapeHtml(school.name)}`,
    sections.map((s) => `<h3 style="font-weight:600;margin:18px 0 6px">${escapeHtml(s.label)}</h3><ul>${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>${s.more ? `<p>...and ${s.more} more.</p>` : ""}${s.stop ? `<p style="font-size:12px"><a href="${escapeHtml(s.stop)}">Stop these emails</a></p>` : ""}`).join(""),
    { label: "Open notifications", url: open });
  return { subject: `${n} ${n === 1 ? "update" : "updates"} · ${school.name}`, text, html };
}
