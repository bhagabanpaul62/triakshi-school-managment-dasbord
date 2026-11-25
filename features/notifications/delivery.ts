import { and, asc, count, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { env, schoolUrl } from "@smw/config";
import { schools, users, withConsole, withSchool, type Tx } from "@smw/db";
import { SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { schoolOrigins } from "@smw/runtime/host";
import { emailHtml, escapeHtml, pushConfigured, services, type EmailSender, type Mail } from "@smw/integrations";
import { todayIST, addDays } from "@smw/feature-kit/money";
import { chunks } from "./constants";
import notificationsFeature from "./feature";
import { isAddressRefusal, suppress, suppressedAmong, unsuppress } from "./email-health";
import { PreferenceService } from "./prefs";
import { quietUntil } from "./quiet";
import { commDeliveries, emailSuppressions, mailUsage, notificationPrefs, notifications, pushSubscriptions, type Delivery, type Notification } from "./schema";
import { loadCommSettings, type CommSettings } from "./settings";
import { topicOf } from "./topics";

type Perm = keyof typeof notificationsFeature.permissions;

const BATCH = 200;
/** Claimed rows are hidden from other drains for this long; a crashed run is retried after it. */
export const LEASE_MS = 10 * 60_000;
/** Minutes to wait after the 1st, 2nd... failed try. One try more than waits: the last failure is final. */
const BACKOFF_MIN = [1, 5, 15, 60, 240];
const PUSH_GAP_MS = 5 * 60_000;
export const NO_BUDGET = "Email limit for today is used up. It will go tomorrow.";
const GENERIC_PUSH = "Open the app to read";
/** Said instead of an unsubscribe link when the server cannot sign one. */
export const SETTINGS_LINE = "To change which emails you get, open Settings in the app.";

// ---------- time and budget ----------

/** 06:00 IST on the next IST day. */
export const tomorrowMorning = (now: Date) => new Date(`${addDays(todayIST(now), 1)}T06:00:00+05:30`);

/** Urgent and safety mail (priority 1 and 2) may use the daily limit except the last fifth, which stays for codes and passwords (`sendAccountMail`). */
const URGENT_SHARE = 0.8;
/** Everything else may use this much of the limit, and one school at most half of that, so one busy school cannot starve the others. */
const NORMAL_SHARE = 0.6;
const SCHOOL_SHARE = 0.5;
export const mailCap = (priority: number) => Math.floor(env().MAIL_DAILY_LIMIT * (priority <= 2 ? URGENT_SHARE : NORMAL_SHARE));

/**
 * Take one email from today's budget, or say no. The check and the count happen under one lock, so two drains never
 * overspend. A mail that fails to send gives its unit back with `releaseMail`.
 */
export async function reserveMail(schoolId: string, priority: number, now: Date): Promise<boolean> {
  const day = todayIST(now);
  const cap = mailCap(priority);
  return withConsole(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('smw-mail-budget'))`);
    const rows = await tx.select({ schoolId: mailUsage.schoolId, n: mailUsage.count }).from(mailUsage).where(eq(mailUsage.day, day));
    const total = rows.reduce((s, r) => s + r.n, 0);
    const mine = rows.find((r) => r.schoolId === schoolId)?.n ?? 0;
    if (total >= cap || (priority > 2 && mine >= Math.floor(cap * SCHOOL_SHARE))) return false;
    await countMail(tx, schoolId, day);
    return true;
  });
}

const countMail = (tx: Tx, schoolId: string, day: string) =>
  tx.insert(mailUsage).values({ schoolId, day, count: 1 }).onConflictDoUpdate({ target: [mailUsage.schoolId, mailUsage.day], set: { count: sql`${mailUsage.count} + 1` } });

/**
 * Codes, reset links and security notices to one person. Always sent (no limit applies, the reserve exists for them) and
 * counted for the school, so the usage page tells the truth. A send that fails throws and is not counted.
 */
export async function sendAccountMail(schoolId: string, mail: Mail, now = new Date()): Promise<void> {
  await services().email.send(mail);
  await withConsole((tx) => countMail(tx, schoolId, todayIST(now))).catch((e) => console.error("account mail sent but not counted", schoolId, e));
}

/** `sendAccountMail` as a sender, for callers that use `trySend(sender, mail)`. */
export const accountMailer = (schoolId: string): EmailSender => ({ send: (mail) => sendAccountMail(schoolId, mail) });

export const releaseMail = (schoolId: string, now: Date) =>
  withConsole((tx) => tx.update(mailUsage).set({ count: sql`greatest(${mailUsage.count} - 1, 0)` }).where(and(eq(mailUsage.schoolId, schoolId), eq(mailUsage.day, todayIST(now)))));

export const unsubscribeHeaders = (url: string) => ({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

// ---------- patches ----------

export interface Patch { state?: Delivery["state"]; reason?: string | null; nextAt?: Date; address?: string; tries?: number; sentAt?: Date }

export const failedTry = (row: Delivery, err: unknown, now: Date): Patch => {
  const tries = row.tries + 1;
  const why = String((err as { message?: string })?.message ?? err).slice(0, 160);
  return tries <= BACKOFF_MIN.length
    ? { state: "pending", tries, nextAt: new Date(now.getTime() + BACKOFF_MIN[tries - 1]! * 60_000), reason: `Could not send (${why}). It will try again.` }
    : { state: "failed", tries, reason: `Gave up after ${tries} tries: ${why}` };
};

export const apply = (ids: string[], p: Patch) => withConsole(async (tx) => {
  for (const part of chunks(ids)) await tx.update(commDeliveries).set({ state: "pending", ...p }).where(inArray(commDeliveries.id, part));
});

// ---------- loading what a batch needs ----------

export interface Person { id: string; name: string; email: string | null; emailVerifiedAt: Date | null; status: string }
export interface Batch {
  notes: Map<string, Notification>;
  people: Map<string, Person>;
  prefs: Map<string, typeof notificationPrefs.$inferSelect>;
  schools: Map<string, { name: string; slug: string; origin?: string }>;
  subs: Map<string, (typeof pushSubscriptions.$inferSelect)[]>;
}

export async function load(rows: Delivery[]): Promise<Batch> {
  const uids = [...new Set(rows.map((r) => r.userId))];
  const nids = [...new Set(rows.flatMap((r) => (r.notificationId ? [r.notificationId] : [])))];
  const sids = [...new Set(rows.map((r) => r.schoolId))];
  const many = <T>(ids: string[], q: (part: string[]) => Promise<T[]>) => Promise.all(chunks(ids).map(q)).then((r) => r.flat());
  return withConsole(async (tx) => {
    const [notes, people, prefs, sch, subs] = await Promise.all([
      many(nids, (p) => tx.select().from(notifications).where(inArray(notifications.id, p))),
      many(uids, (p) => tx.select({ id: users.id, name: users.name, email: users.email, emailVerifiedAt: users.emailVerifiedAt, status: users.status }).from(users).where(inArray(users.id, p))),
      many(uids, (p) => tx.select().from(notificationPrefs).where(inArray(notificationPrefs.userId, p))),
      many(sids, (p) => tx.select({ id: schools.id, name: schools.name, slug: schools.slug }).from(schools).where(inArray(schools.id, p))),
      rows.some((r) => r.channel === "push") ? many(uids, (p) => tx.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, p))) : [],
    ]);
    const origins = await schoolOrigins(tx, sch);
    const subMap = new Map<string, typeof subs>();
    for (const s of subs) subMap.set(`${s.schoolId}:${s.userId}`, [...(subMap.get(`${s.schoolId}:${s.userId}`) ?? []), s]);
    return {
      notes: new Map(notes.map((n) => [n.id, n])), people: new Map(people.map((p) => [p.id, p])),
      prefs: new Map(prefs.map((p) => [`${p.schoolId}:${p.userId}`, p])), schools: new Map(sch.map((s) => [s.id, { ...s, origin: origins.get(s.id) }])), subs: subMap,
    };
  });
}

type SettingsCache = Map<string, Promise<CommSettings>>;
/** Per drain: the settings of each school are read once. */
const settingsOf = (cache: SettingsCache, schoolId: string) => cache.get(schoolId) ?? cache.set(schoolId, withSchool(schoolId, loadCommSettings)).get(schoolId)!;

/** The email of the family's primary guardian, for logins without an email of their own. */
async function guardianEmail(tx: Tx, schoolId: string, userId: string): Promise<string | null> {
  const [t] = [...(await tx.execute(sql`select to_regclass('student_guardians') is not null and to_regclass('guardians') is not null as ok`))] as { ok: boolean }[];
  if (!t?.ok) return null;
  const [r] = [...(await tx.execute(sql`select g.email from students s join student_guardians sg on sg.student_id = s.id join guardians g on g.id = sg.guardian_id
    where s.school_id = ${schoolId} and s.user_id = ${userId} and sg.is_primary and coalesce(g.email, '') <> '' order by g.created_at limit 1`))] as { email: string }[];
  return r?.email ?? null;
}

// ---------- the drain ----------

export interface DeliverOptions { schoolId?: string; /** Only priority 1 and 2: runs even in quiet hours. */ urgentOnly?: boolean; now?: Date; /** Rows to handle in this run (default: all that are due). */ limit?: number; /** Stop starting new batches after this long (default 50 s). */ maxMs?: number }
export interface DeliverResult { sent: number; skipped: number; deferred: number; retried: number; failed: number }
const MAX_MS = 50_000;

/** Take up to 200 due rows by priority and hide them from other drains while we send. */
async function claim(now: Date, o: DeliverOptions, take: number): Promise<Delivery[]> {
  return withConsole(async (tx) => {
    const due = await tx.select().from(commDeliveries)
      .where(and(eq(commDeliveries.state, "pending"), eq(commDeliveries.mode, "instant"), lte(commDeliveries.nextAt, now),
        o.schoolId ? eq(commDeliveries.schoolId, o.schoolId) : undefined, o.urgentOnly ? lte(commDeliveries.priority, 2) : undefined))
      .orderBy(asc(commDeliveries.priority), asc(commDeliveries.nextAt)).limit(take).for("update", { skipLocked: true });
    if (due.length) await tx.update(commDeliveries).set({ nextAt: new Date(now.getTime() + LEASE_MS) }).where(inArray(commDeliveries.id, due.map((d) => d.id)));
    return due;
  });
}

/**
 * Send what is due, most urgent first. Safe to run twice at once: a row is claimed under a lock before anything is sent,
 * and one school or one address failing never stops the rest.
 */
export async function deliverDue(o: DeliverOptions = {}): Promise<DeliverResult> {
  const now = o.now ?? new Date();
  const out: DeliverResult = { sent: 0, skipped: 0, deferred: 0, retried: 0, failed: 0 };
  const cache: SettingsCache = new Map();
  const stopAt = Date.now() + (o.maxMs ?? MAX_MS);
  let left = o.limit ?? Infinity;
  // Urgent and safety first, so a long queue of ordinary mail never holds them back; then batches until the time is spent.
  for (const urgentOnly of o.urgentOnly ? [true] : [true, false]) {
    while (left > 0 && Date.now() < stopAt) {
      const rows = await claim(now, { ...o, urgentOnly }, Math.min(BATCH, left));
      if (!rows.length) break;
      left -= rows.length;
      await new Drain(now, out, await load(rows), cache).run(rows);
    }
  }
  return out;
}

class Drain {
  constructor(private now: Date, private out: DeliverResult, private b: Batch, private cache: SettingsCache) {}

  private async done(ids: string[], p: Patch) {
    await apply(ids, p);
    const n = ids.length;
    if (p.state === "sent") this.out.sent += n;
    else if (p.state === "skipped" || p.state === "bounced") this.out.skipped += n;
    else if (p.state === "failed") this.out.failed += n;
    else if (p.tries) this.out.retried += n;
    else this.out.deferred += n;
  }

  /** Once something went out, saving the result is best effort: failing here must never release the row for a second send. */
  private async settle(row: Delivery, p: Patch) {
    if (p.state !== "sent") return this.done([row.id], p);
    await this.done([row.id], p).catch((err) => { this.out.sent++; console.error("delivery sent but not saved", row.id, err); });
  }

  async run(rows: Delivery[]) {
    const mails: Plan[] = [];
    for (const row of rows) {
      try {
        const early = await this.gate(row);
        if (early) await this.done([row.id], early);
        else if (row.channel === "push") await this.settle(row, await this.push(row));
        else { const p = await this.plan(row); if ("patch" in p) await this.done([row.id], p.patch); else mails.push(p); }
      } catch (err) {
        await this.done([row.id], failedTry(row, err, this.now)).catch(() => {});
      }
    }
    await this.mails(mails);
  }

  /** Reasons not to send anything: gone, read, disabled, quiet hours. */
  private async gate(row: Delivery): Promise<Patch | null> {
    const note = row.notificationId ? this.b.notes.get(row.notificationId) : undefined;
    if (!note) return { state: "skipped", reason: "The notification no longer exists." };
    if (note.readAt || note.doneAt) return { state: "skipped", reason: "Already read in the app" };
    const person = this.b.people.get(row.userId);
    if (!person || person.status !== "active") return { state: "skipped", reason: "The account is not active." };
    if (row.priority > 2) {
      const own = this.b.prefs.get(`${row.schoolId}:${row.userId}`);
      const s = await settingsOf(this.cache, row.schoolId);
      const until = quietUntil(this.now, { from: own?.quietFrom && own.quietTo ? own.quietFrom : s.quietFrom, to: own?.quietFrom && own.quietTo ? own.quietTo : s.quietTo, sundays: s.quietSundays, awayUntil: own?.awayUntil });
      if (until) return { state: "pending", nextAt: until, reason: null };
    }
    return null;
  }

  private async push(row: Delivery): Promise<Patch> {
    const note = this.b.notes.get(row.notificationId!)!;
    const subs = this.b.subs.get(`${row.schoolId}:${row.userId}`) ?? [];
    if (!subs.length) return { state: "skipped", reason: "No device" };
    // One push per group in 5 minutes, so a busy thread does not buzz the phone; the next one carries the latest count.
    const gk = note.groupKey;
    if (gk && !note.urgent && row.priority > 1) {
      const [last] = await withConsole((tx) => tx.select({ at: sql<Date | null>`max(${commDeliveries.sentAt})` }).from(commDeliveries).innerJoin(notifications, eq(notifications.id, commDeliveries.notificationId))
        .where(and(eq(commDeliveries.schoolId, row.schoolId), eq(commDeliveries.userId, row.userId), eq(commDeliveries.channel, "push"), eq(notifications.groupKey, gk), gt(commDeliveries.sentAt, new Date(this.now.getTime() - PUSH_GAP_MS)))));
      if (last?.at) return { state: "pending", nextAt: new Date(new Date(last.at).getTime() + PUSH_GAP_MS), reason: null };
    }
    const payload = { title: note.title, body: note.privateBody ? GENERIC_PUSH : (note.body ?? ""), href: note.href ?? "/app/notifications", tag: note.groupKey ?? note.id };
    const opts = { ttl: row.priority <= 3 ? 86_400 : 14_400, urgency: (row.priority <= 2 ? "high" : row.priority === 3 ? "normal" : "low") as "high" | "normal" | "low" };
    const ok: string[] = [], gone: string[] = [];
    let error: unknown;
    for (const s of subs) {
      try { if ((await services().push.send(s, payload, opts)) === "ok") ok.push(s.id); else gone.push(s.id); } catch (e) { error = e; }
    }
    const tidy = (e: unknown) => console.error("push housekeeping failed", e);
    if (gone.length) await withConsole((tx) => tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone))).catch(tidy);
    if (ok.length) {
      await withConsole((tx) => tx.update(pushSubscriptions).set({ lastOkAt: this.now }).where(inArray(pushSubscriptions.id, ok))).catch(tidy);
      return { state: "sent", tries: row.tries + 1, sentAt: this.now, reason: null };
    }
    if (error) return failedTry(row, error, this.now);
    return { state: "skipped", reason: "No device" };
  }

  private async plan(row: Delivery): Promise<Plan | { patch: Patch }> {
    const note = this.b.notes.get(row.notificationId!)!, person = this.b.people.get(row.userId)!;
    const t = await emailTarget(person, note, row);
    return "patch" in t ? t : { row, note, person, ...t };
  }

  private async mails(plans: Plan[]) {
    const groups = new Map<string, Plan[]>();
    for (const p of plans) {
      const k = [p.row.schoolId, p.address.toLowerCase(), p.limited ? `limited:${p.note.topic}` : p.note.title, p.note.href ?? "", p.limited ? "" : p.note.body ?? ""].join("\u0001");
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    for (const g of groups.values()) {
      const ids = g.map((p) => p.row.id), first = g[0]!, schoolId = first.row.schoolId;
      try {
        const priority = Math.min(...g.map((p) => p.row.priority));
        if (!(await reserveMail(schoolId, priority, this.now))) { await this.done(ids, { state: "pending", nextAt: tomorrowMorning(this.now), reason: NO_BUDGET }); continue; }
        const school = this.b.schools.get(schoolId)!;
        const mustTell = topicOf(first.note.topic).mustTell;
        const unsub = mustTell ? null : await withConsole((tx) => PreferenceService.unsubscribeUrlFor(tx, schoolId, school.slug, first.row.userId));
        try {
          await services().email.send({ to: first.address, ...compose(school, g, !mustTell && !unsub), headers: unsub ? unsubscribeHeaders(unsub) : undefined });
        } catch (err) {
          await releaseMail(schoolId, this.now);
          if (isAddressRefusal(err)) {
            await withConsole((tx) => suppress(tx, schoolId, first.address, "bounced"));
            await this.done(ids, { state: "bounced", address: first.address, reason: "The mailbox refused the mail. Correct the address to start again." });
          } else await Promise.all(g.map((p) => this.done([p.row.id], failedTry(p.row, err, this.now))));
          continue;
        }
        // Sent. From here nothing may release or resend it: marking it sent is best effort.
        this.out.sent += ids.length;
        await Promise.all(g.map((p) => apply([p.row.id], { state: "sent", address: first.address, tries: p.row.tries + 1, sentAt: this.now, reason: null }))).catch((e) => console.error("mail sent but not saved", ids, e));
      } catch (err) {
        await Promise.all(g.map((p) => this.done([p.row.id], failedTry(p.row, err, this.now)).catch(() => {})));
      }
    }
  }
}

export interface EmailTarget { address: string; limited: boolean; guardian: boolean }

/** Where an email goes and what it may say, or why it cannot go. Private words only reach the person's own verified address. */
export async function emailTarget(person: Person, note: Notification, row: Delivery): Promise<EmailTarget | { patch: Patch }> {
  const own = !!person.email;
  const address = person.email ?? await withConsole((tx) => guardianEmail(tx, row.schoolId, row.userId));
  if (!address) return { patch: { state: "skipped", reason: "No email address on file. Add one in the person's profile." } };
  const suppressed = await withConsole((tx) => suppressedAmong(tx, row.schoolId, [address]));
  if (suppressed.has(address.toLowerCase())) return { patch: { state: "skipped", address, reason: "Emails to this address are stopped because it bounced or was reported. Correct the address to start again." } };
  return { address, limited: note.privateBody && !(own && person.emailVerifiedAt), guardian: !own };
}

interface Plan extends EmailTarget { row: Delivery; note: Notification; person: Person }

/** One mail for one or more rows with the same address, words and link (brothers and sisters). */
export function compose(school: { name: string; slug: string; origin?: string }, g: Plan[], noUnsubscribe: boolean): Pick<Mail, "subject" | "text" | "html"> {
  const { note, limited } = g[0]!;
  const names = [...new Set(g.map((p) => p.person.name))];
  const url = `${school.origin ?? schoolUrl(school.slug)}${note.href ?? "/app/notifications"}`;
  const subject = `${limited ? topicOf(note.topic).label : note.title} · ${school.name}`;
  const forLine = names.length > 1 || g[0]!.guardian ? `For ${names.join(" and ")}` : "";
  const body = limited ? "Sign in to read it." : note.body ?? "";
  const title = limited ? `New: ${topicOf(note.topic).label}` : note.title;
  return {
    subject,
    text: [forLine, title, body, `Open it: ${url}`, noUnsubscribe ? SETTINGS_LINE : ""].filter(Boolean).join("\n\n"),
    html: emailHtml(escapeHtml(title), `${forLine ? `<p style="color:#666">${escapeHtml(forLine)}</p>` : ""}${body ? `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>` : ""}${noUnsubscribe ? `<p style="font-size:12px">${SETTINGS_LINE}</p>` : ""}`, { label: limited ? "Sign in to read" : "Open", url }),
  };
}

// ---------- the admin screen ----------

export interface DeliverySummary {
  byChannel: { channel: string; state: string; n: number }[];
  problems: { channel: string; state: string; reason: string; n: number }[];
  quota: { limit: number; forNotices: number; used: number; left: number; schoolUsed: number };
  /** Emails waiting for tomorrow because the limit was reached. */
  waiting: number;
  failedCount: number;
}

/** What went out, what did not and why. For admins only (`delivery`). */
export class DeliveryService extends SchoolService<Perm> {
  protected feature = notificationsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  async summary(): Promise<DeliverySummary> {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const day = todayIST();
    const limit = env().MAIL_DAILY_LIMIT, forNotices = mailCap(4);
    const used = await this.read("delivery", async (tx) => {
      const [byChannel, problems, [waiting], [failed], [mine]] = await Promise.all([
        tx.select({ channel: commDeliveries.channel, state: commDeliveries.state, n: count() }).from(commDeliveries).where(gt(commDeliveries.createdAt, since)).groupBy(commDeliveries.channel, commDeliveries.state),
        tx.select({ channel: commDeliveries.channel, state: commDeliveries.state, reason: sql<string>`coalesce(${commDeliveries.reason}, 'No reason given')`, n: count() }).from(commDeliveries)
          .where(and(gt(commDeliveries.createdAt, since), inArray(commDeliveries.state, ["failed", "bounced", "skipped"]))).groupBy(commDeliveries.channel, commDeliveries.state, commDeliveries.reason).orderBy(sql`count(*) desc`).limit(30),
        tx.select({ n: count() }).from(commDeliveries).where(and(eq(commDeliveries.state, "pending"), eq(commDeliveries.reason, NO_BUDGET))),
        tx.select({ n: count() }).from(commDeliveries).where(eq(commDeliveries.state, "failed")),
        tx.select({ n: mailUsage.count }).from(mailUsage).where(eq(mailUsage.day, day)),
      ]);
      return { byChannel: byChannel.map((r) => ({ ...r, n: Number(r.n) })), problems: problems.map((r) => ({ ...r, n: Number(r.n) })), waiting: Number(waiting?.n ?? 0), failedCount: Number(failed?.n ?? 0), schoolUsed: mine?.n ?? 0 };
    });
    // The limit is shared by every school, so today's total needs a look across schools (a number only).
    const [t] = await withConsole((tx) => tx.select({ n: sql<number>`coalesce(sum(${mailUsage.count}), 0)::int` }).from(mailUsage).where(eq(mailUsage.day, day)));
    const total = Number(t?.n ?? 0);
    return { byChannel: used.byChannel, problems: used.problems, waiting: used.waiting, failedCount: used.failedCount,
      quota: { limit, forNotices, used: total, left: Math.max(forNotices - total, 0), schoolUsed: used.schoolUsed } };
  }

  /** Put failed rows back in the queue: the ones named, or all of them. */
  async retry(ids: string[] | "all"): Promise<number> {
    const rows = await this.write("delivery", (tx) => tx.update(commDeliveries).set({ state: "pending", tries: 0, nextAt: new Date(), reason: null })
      .where(and(eq(commDeliveries.state, "failed"), ids === "all" ? undefined : inArray(commDeliveries.id, ids))).returning({ id: commDeliveries.id }),
    (r) => ({ action: "delivery.retry", entity: "comm_delivery", summary: `Retried ${r.length} failed deliveries` }));
    return rows.length;
  }

  suppressed() {
    return this.read("delivery", (tx) => tx.select().from(emailSuppressions).orderBy(asc(emailSuppressions.address)).limit(200));
  }

  /** The office corrected or confirmed the address: mail may go again. */
  async worksAgain(address: string): Promise<void> {
    await this.write("delivery", (tx) => unsuppress(tx, this.ctx.schoolId, address), () => ({ action: "delivery.works-again", entity: "email_suppression", summary: `Emails to ${address} allowed again` }));
  }
}

/** "Send me a test": one push to the caller's own devices, straight away, so they can see it works. */
export class PushTestService extends SchoolService<Perm> {
  protected feature = notificationsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  async send(): Promise<number> {
    if (!pushConfigured()) throw new ValidationError({ push: "Push is not set up on this server yet. Ask the platform team." });
    const subs = await this.read("read", (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, this.ctx.userId)));
    if (!subs.length) throw new ValidationError({ push: "No device is turned on yet. Turn on notifications on this device first." });
    const gone: string[] = [];
    let ok = 0;
    for (const s of subs) {
      try { if ((await services().push.send(s, { title: "Test notification", body: "Notifications work on this device.", href: "/app/notifications", tag: "test" }, { ttl: 300, urgency: "normal" })) === "ok") ok++; else gone.push(s.id); } catch { /* counted as not delivered */ }
    }
    if (gone.length) await withSchool(this.ctx.schoolId, (tx) => tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone)));
    if (!ok) throw new ValidationError({ push: "The test did not arrive. Turn notifications off and on again on this device." });
    return ok;
  }
}
