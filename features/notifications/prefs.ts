import { createHash, createHmac } from "node:crypto";
import { sha256 } from "@smw/feature-kit/secret";
import { and, desc, eq, sql } from "drizzle-orm";
import { env, isLocal, schoolUrl } from "@smw/config";
import { users, withSchool, type Tx } from "@smw/db";
import { NotFoundError, refuseSupport, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { defaultsFor, effectiveGroup, type GroupPref, type GroupPrefs } from "./channels";
import notificationsFeature from "./feature";
import { awayInput, digestInput, groupPrefInput, languageInput, quietInput, subscribeInput } from "./inputs";
import { notificationPrefs, pushSubscriptions } from "./schema";
import { lockedGroup, TOPIC_GROUPS, type TopicGroup } from "./topics";
import { NotificationWriter } from "./writer";

type Perm = keyof typeof notificationsFeature.permissions;
export { channelsFor, effectiveGroup, priorityOf } from "./channels";

export interface MyPrefs {
  /** What each group does for this person right now (their choice, else the school's, else the default). */
  groups: Record<TopicGroup, GroupPref & { locked: boolean; own: boolean }>;
  digestHour: 8 | 18;
  quietFrom: string | null; quietTo: string | null;
  awayUntil: string | null; awayText: string | null;
  language: string | null;
}
export interface Device { id: string; device: string | null; createdAt: Date; lastOkAt: Date | null }

const LOCKED = "These are always sent, so they cannot be turned off.";
/** The unsubscribe token is derived, not stored, so a link in an old email keeps working; only its sha-256 is kept for lookup. */
/** The secret behind signed links: DATA_KEY, or a fixed key on a developer's machine only. In production without DATA_KEY there is none, so no link is made. */
export const tokenKeyFor = (dataKey: string | undefined, local: boolean): string | null => dataKey ?? (local ? "local-only-data-key" : null);
export const tokenKey = () => tokenKeyFor(env().DATA_KEY, isLocal());
const tokenFor = (key: string, schoolId: string, userId: string) => createHmac("sha256", createHash("sha256").update(key).digest()).update(`unsubscribe:${schoolId}:${userId}`).digest("base64url");

const GROUPS = Object.keys(TOPIC_GROUPS) as TopicGroup[];

/** A person's own notification settings. Always about ctx.userId; works in a read-only school (it is not sending). */
export class PreferenceService extends SchoolService<Perm> {
  protected feature = notificationsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  private mineWhere = () => eq(notificationPrefs.userId, this.ctx.userId);
  private upsert(tx: Tx, set: Partial<typeof notificationPrefs.$inferInsert>) {
    return tx.insert(notificationPrefs).values({ schoolId: this.ctx.schoolId, userId: this.ctx.userId, ...set }).onConflictDoUpdate({ target: [notificationPrefs.schoolId, notificationPrefs.userId], set });
  }

  async mine(): Promise<MyPrefs> {
    return this.read("read", async (tx) => {
      const [[p], school] = await Promise.all([tx.select().from(notificationPrefs).where(this.mineWhere()).limit(1), NotificationWriter.schoolDefaults(tx)]);
      const groups = Object.fromEntries(GROUPS.map((g) => [g, { ...(lockedGroup(g) ? { push: true, email: "instant" as const } : effectiveGroup(g, p?.groups, defaultsFor(school, this.ctx.role))), locked: lockedGroup(g), own: !!p?.groups?.[g] }])) as MyPrefs["groups"];
      return { groups, digestHour: p?.digestHour ?? 18, quietFrom: p?.quietFrom ?? null, quietTo: p?.quietTo ?? null, awayUntil: p?.awayUntil ?? null, awayText: p?.awayText ?? null, language: p?.language ?? null };
    });
  }

  async saveGroup(input: unknown): Promise<GroupPref> {
    refuseSupport(this.ctx, "change notification settings");
    const { group, ...pref } = this.parse(groupPrefInput, input);
    if (lockedGroup(group)) throw new ValidationError({ [group]: LOCKED });
    return this.read("read", async (tx) => {
      await tx.insert(notificationPrefs).values({ schoolId: this.ctx.schoolId, userId: this.ctx.userId, groups: { [group]: pref } })
        .onConflictDoUpdate({ target: [notificationPrefs.schoolId, notificationPrefs.userId], set: { groups: sql`${notificationPrefs.groups} || excluded.groups` } });
      return pref;
    });
  }

  async saveQuiet(input: unknown) {
    refuseSupport(this.ctx, "change quiet hours");
    const q = this.parse(quietInput, input);
    return this.read("read", (tx) => this.upsert(tx, { quietFrom: q?.from ?? null, quietTo: q?.to ?? null }));
  }

  async saveDigest(hour: unknown) {
    refuseSupport(this.ctx, "change the digest hour");
    const digestHour = this.parse(digestInput, hour);
    return this.read("read", (tx) => this.upsert(tx, { digestHour }));
  }

  async saveLanguage(language: unknown) {
    refuseSupport(this.ctx, "change the language");
    return this.read("read", (tx) => this.upsert(tx, { language: this.parse(languageInput, language) }));
  }

  async setAway(until: unknown, text?: unknown) {
    refuseSupport(this.ctx, "set an away message");
    const a = this.parse(awayInput, { until, text });
    return this.read("read", (tx) => this.upsert(tx, { awayUntil: a.until, awayText: a.until ? (a.text || null) : null }));
  }

  async devices(): Promise<Device[]> {
    return this.read("read", (tx) => tx.select({ id: pushSubscriptions.id, device: pushSubscriptions.device, createdAt: pushSubscriptions.createdAt, lastOkAt: pushSubscriptions.lastOkAt })
      .from(pushSubscriptions).where(eq(pushSubscriptions.userId, this.ctx.userId)).orderBy(desc(pushSubscriptions.createdAt)));
  }

  async removeDevice(id: string) {
    refuseSupport(this.ctx, "remove a device");
    const rows = await this.read("read", (tx) => tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, this.ctx.userId), eq(pushSubscriptions.id, id))).returning({ id: pushSubscriptions.id }));
    if (!rows.length) throw new NotFoundError("Device");
  }

  async subscribe(endpoint: string, p256dh: string, auth: string, device?: string) {
    refuseSupport(this.ctx, "add a device");
    const s = this.parse(subscribeInput, { endpoint, p256dh, auth, device });
    return this.read("read", async (tx) => {
      await tx.insert(pushSubscriptions).values({ schoolId: this.ctx.schoolId, userId: this.ctx.userId, ...s, device: s.device ?? null })
        .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: this.ctx.userId, p256dh: s.p256dh, auth: s.auth, device: s.device ?? null } });
    });
  }

  /**
   * From the link in an email, no sign-in. Turns email off for one group, or for every group that may be turned off.
   * Only the person the token belongs to is changed. Returns null when the link is not valid.
   */
  static async unsubscribeByToken(schoolId: string, token: string, group?: TopicGroup): Promise<{ userId: string; groups: TopicGroup[] } | null> {
    if (group && !GROUPS.includes(group)) return null;
    if (group && lockedGroup(group)) throw new ValidationError({ group: LOCKED });
    return withSchool(schoolId, async (tx) => {
      const [p] = await tx.select().from(notificationPrefs).where(and(eq(notificationPrefs.schoolId, schoolId), eq(notificationPrefs.unsubscribeHash, sha256(token)))).limit(1);
      if (!p) return null;
      const [u] = await tx.select({ role: users.role }).from(users).where(eq(users.id, p.userId)).limit(1);
      const school = defaultsFor(await NotificationWriter.schoolDefaults(tx), u?.role ?? "");
      const hit = group ? [group] : GROUPS.filter((g) => !lockedGroup(g));
      const groups: GroupPrefs = { ...p.groups, ...Object.fromEntries(hit.map((g) => [g, { push: effectiveGroup(g, p.groups, school).push, email: "off" }])) };
      await tx.update(notificationPrefs).set({ groups }).where(eq(notificationPrefs.id, p.id));
      return { userId: p.userId, groups: hit };
    });
  }

  /** The unsubscribe link for an email to this person (never signs in; the page behind it only calls unsubscribeByToken). Null when the server has no secret to sign it with. */
  static async unsubscribeUrlFor(tx: Tx, schoolId: string, slug: string, userId: string, group?: TopicGroup): Promise<string | null> {
    const key = tokenKey();
    if (!key) return null;
    const token = tokenFor(key, schoolId, userId);
    await tx.insert(notificationPrefs).values({ schoolId, userId, unsubscribeHash: sha256(token) })
      .onConflictDoUpdate({ target: [notificationPrefs.schoolId, notificationPrefs.userId], set: { unsubscribeHash: sha256(token) } });
    return schoolUrl(slug, `/unsubscribe?${new URLSearchParams({ t: token, ...(group ? { g: group } : {}) })}`);
  }
}
