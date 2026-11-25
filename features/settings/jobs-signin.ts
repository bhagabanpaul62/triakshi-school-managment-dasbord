import { and, count, eq, gt, inArray, loginEvents, ne, sql, users, withConsole, withSchool } from "@smw/db";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { notifications } from "@smw/feature-notifications/schema";

/** 10 failed tries on one typed login inside an hour. */
export const BURST = 10;
const HOUR = 3_600_000;

/**
 * Tells a school's admins (`account.security`, which they cannot switch off) when one login has failed 10 times in an hour.
 * Once per login per clock hour: the notice carries a group key with the hour, and a key that already exists is skipped.
 * Only a wrong password or code on a login that exists counts. Unknown names (anyone can type any), the support link and "too many tries" rows do not: they are noise or the answer to a burst, and would make an alert nobody can act on.
 * One school failing does not stop the others; the job fails at the end so the queue tries again.
 */
export async function watchSignIns(now = new Date()): Promise<{ told: number }> {
  const bursts = await withConsole((tx) => tx.select({ schoolId: loginEvents.schoolId, identifier: loginEvents.identifier, n: count(), from: sql<number>`count(distinct ${loginEvents.ip})` })
    .from(loginEvents).where(and(inArray(loginEvents.outcome, ["bad_password", "bad_code"]), ne(loginEvents.identifier, "support link"), gt(loginEvents.createdAt, new Date(now.getTime() - HOUR))))
    .groupBy(loginEvents.schoolId, loginEvents.identifier).having(sql`count(*) >= ${BURST}`));
  let told = 0;
  const hour = Math.floor(now.getTime() / HOUR);
  let failed = 0;
  for (const b of bursts) {
    const key = `signin-burst:${b.identifier}:${hour}`;
    try {
    told += await withSchool(b.schoolId, async (tx) => {
      const [seen] = await tx.select({ id: notifications.id }).from(notifications).where(eq(notifications.groupKey, key)).limit(1);
      if (seen) return 0;
      const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
      return NotificationWriter.insert(tx, b.schoolId, admins.map((a) => ({
        userId: a.id, topic: "account.security" as const, title: `${b.n} failed sign-ins on one login in the last hour`,
        body: `Someone typed "${b.identifier}" and failed ${b.n} times, from ${Number(b.from) || 1} address${Number(b.from) > 1 ? "es" : ""}. If this is not a person forgetting a password, reset it and check the sign-in activity.`,
        href: `/app/settings/sign-ins?outcome=failed&q=${encodeURIComponent(b.identifier)}`, subject: { type: "signin-burst", id: b.identifier }, groupKey: key, urgent: true,
      })));
    });
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ level: "error", msg: "sign-in watch failed", schoolId: b.schoolId, err: String(err) }));
    }
  }
  if (failed) throw new Error(`settings.sign-in-watch failed for ${failed} of ${bursts.length} logins`);
  return { told };
}

export const signInJobs = { "settings.sign-in-watch": async () => watchSignIns() } satisfies Record<string, () => Promise<unknown>>;
