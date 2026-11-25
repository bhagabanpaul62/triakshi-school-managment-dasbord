import { and, eq, inArray, loginEvents, lt, users, withConsole } from "@smw/db";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { expireExports, runExports } from "./export-run";
import { signInJobs } from "./jobs-signin";
import { privacyRequests } from "./schema";

const DAY = 86_400_000;
const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Sign-in events are kept 180 days. */
export const SIGN_IN_KEEP_DAYS = 180;

/** Whether a reminder is due: the first one inside 14 days, one on the due day, then one a week while it is late. */
export function reminderDue(dueOn: string, remindedOn: string | null, today: string): boolean {
  const left = between(today, dueOn);
  if (remindedOn === today) return false;
  if (!remindedOn) return left <= 14;
  if (left > 0) return false;
  if (between(remindedOn, dueOn) > 0) return true; // the due day itself, or the first day we noticed it was past
  return between(remindedOn, today) >= 7;
}

/** Job `settings.privacy-due`: owners (or every admin when there is none) hear 14 days before, on the day and weekly after. */
export async function privacyDue(now = new Date()): Promise<number> {
  const today = istDay(now);
  const open = await withConsole((tx) => tx.select().from(privacyRequests).where(inArray(privacyRequests.state, ["open", "in_progress"])));
  const bySchool = new Map<string, typeof open>();
  for (const r of open.filter((x) => reminderDue(x.dueOn, x.remindedOn, today))) bySchool.set(r.schoolId, [...(bySchool.get(r.schoolId) ?? []), r]);
  let told = 0, failed = 0;
  // One school at a time, each in its own transaction: a school that fails does not stop the others (the job fails at the end, so the queue tries again).
  for (const [schoolId, due] of bySchool) {
    try {
      told += await withConsole(async (tx) => {
        const admins = (await tx.select({ id: users.id }).from(users).where(and(eq(users.schoolId, schoolId), eq(users.role, "admin"), eq(users.status, "active")))).map((u) => u.id);
        const active = new Set((await tx.select({ id: users.id }).from(users).where(and(eq(users.schoolId, schoolId), eq(users.status, "active")))).map((u) => u.id));
        let n = 0;
        for (const r of due) {
          // An owner who was disabled or left cannot act on it: the admins are told instead.
          const ids = r.ownerId && active.has(r.ownerId) ? [r.ownerId] : admins;
          const left = between(today, r.dueOn);
          const title = left < 0 ? `Privacy request ${r.ref} is ${-left} ${-left === 1 ? "day" : "days"} late` : left === 0 ? `Privacy request ${r.ref} is due today` : `Privacy request ${r.ref} is due in ${left} days`;
          n += await NotificationWriter.insert(tx, schoolId, ids.map((userId) => ({
            userId, topic: "privacy.request" as const, title, body: `${r.subjectName}. The school must answer by ${r.dueOn}.`, href: `/app/settings/privacy/${r.id}`, subject: { type: "privacy", id: r.id }, action: true, urgent: left <= 0, groupKey: `privacy:${r.id}`,
          })));
          await tx.update(privacyRequests).set({ remindedOn: today }).where(eq(privacyRequests.id, r.id));
        }
        return n;
      });
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ level: "error", msg: "privacy reminders failed", schoolId, err: String(err) }));
    }
  }
  if (failed) throw new Error(`settings.privacy-due failed for ${failed} of ${bySchool.size} schools`);
  return told;
}

/** Job `settings.cleanup`: export files past 7 days go, and sign-in events past 180 days. */
export async function cleanup(now = new Date()) {
  const exports = await expireExports(now);
  const events = await withConsole((tx) => tx.delete(loginEvents).where(lt(loginEvents.createdAt, new Date(now.getTime() - SIGN_IN_KEEP_DAYS * DAY))).returning({ id: loginEvents.id }));
  return { exports, signInEvents: events.length };
}

export const exportJobs = { "settings.exports": async () => { await runExports(); } } satisfies Record<string, () => Promise<unknown>>;
export const privacyJobs = { "settings.privacy-due": async () => { await privacyDue(); } } satisfies Record<string, () => Promise<unknown>>;

export default {
  ...exportJobs, ...privacyJobs, ...signInJobs,
  "settings.cleanup": async () => { await cleanup(); },
} satisfies Record<string, () => Promise<unknown>>;
