import { and, eq, inArray, isNull } from "drizzle-orm";
import { schoolUrl } from "@smw/config";
import { schools, users, withConsole } from "@smw/db";
import { emailHtml, services } from "@smw/integrations";
import { notificationPrefs, notifications } from "./schema";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MAX_LINES = 15;

export interface DigestResult { users: number; emails: number; notifications: number; failed: number }

/**
 * Daily digest: one email per user with unread notifications nobody has emailed yet, unless they turned it off.
 * Idempotent and safe to run twice at once: each user's notifications are claimed by stamping `digest_sent_at`
 * in one statement before sending; a failed send releases the claim so the next run retries.
 */
export async function runEmailDigest(opts: { schoolId?: string } = {}): Promise<DigestResult> {
  const pending = await withConsole((tx) => tx
    .select({ userId: notifications.userId, name: users.name, email: users.email, schoolName: schools.name, slug: schools.slug, emailDigest: notificationPrefs.emailDigest })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .innerJoin(schools, eq(schools.id, notifications.schoolId))
    .leftJoin(notificationPrefs, and(eq(notificationPrefs.userId, notifications.userId), eq(notificationPrefs.schoolId, notifications.schoolId)))
    .where(and(isNull(notifications.readAt), isNull(notifications.digestSentAt), eq(users.status, "active"), opts.schoolId ? eq(notifications.schoolId, opts.schoolId) : undefined))
    .groupBy(notifications.userId, users.name, users.email, schools.name, schools.slug, notificationPrefs.emailDigest));

  const out: DigestResult = { users: 0, emails: 0, notifications: 0, failed: 0 };
  for (const u of pending) {
    if (!u.email || u.emailDigest === false) continue;
    out.users++;
    const claimed = await withConsole((tx) => tx.update(notifications).set({ digestSentAt: new Date() })
      .where(and(eq(notifications.userId, u.userId), isNull(notifications.readAt), isNull(notifications.digestSentAt)))
      .returning({ id: notifications.id, title: notifications.title, body: notifications.body, createdAt: notifications.createdAt }));
    if (!claimed.length) continue;
    claimed.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const shown = claimed.slice(0, MAX_LINES);
    const more = claimed.length - shown.length;
    const n = claimed.length;
    const subject = `${n} new ${n === 1 ? "notification" : "notifications"} at ${u.schoolName}`;
    const text = `Hi ${u.name},\n\n${shown.map((c) => `- ${c.title}${c.body ? `: ${c.body}` : ""}`).join("\n")}${more > 0 ? `\n...and ${more} more` : ""}\n\nOpen your notifications: ${schoolUrl(u.slug, "/app/notifications")}\n`;
    const html = emailHtml(`You have ${n} new ${n === 1 ? "notification" : "notifications"}`,
      `<p>Hi ${esc(u.name)},</p><ul>${shown.map((c) => `<li><strong>${esc(c.title)}</strong>${c.body ? ` - ${esc(c.body)}` : ""}</li>`).join("")}</ul>${more > 0 ? `<p>...and ${more} more.</p>` : ""}`,
      { label: "Open notifications", url: schoolUrl(u.slug, "/app/notifications") });
    try {
      await services().email.send({ to: u.email, subject, text, html });
      out.emails++;
      out.notifications += n;
    } catch (err) {
      out.failed++;
      await withConsole((tx) => tx.update(notifications).set({ digestSentAt: null }).where(inArray(notifications.id, claimed.map((c) => c.id))));
      console.error(JSON.stringify({ level: "error", msg: "digest email failed", userId: u.userId, err: String(err) }));
    }
  }
  return out;
}

export default {
  "notifications.email-digest": async (data?: { schoolId?: string }) => runEmailDigest({ schoolId: data?.schoolId }),
};
