import { and, asc, eq, gte, inArray, like, lt, ne, or, isNotNull, isNull } from "drizzle-orm";
import { env } from "@smw/config";
import { schoolDomainEvents, schoolDomains, users, withConsole, type DomainRecordCheck, type Tx } from "@smw/db";
import { DnsUnavailableError, services, type DnsResolver, type TlsProbe } from "@smw/integrations";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { forgetHost, healthyMain } from "@smw/runtime/host";
import { sitesIp } from "./hostname";
import { DomainVerifier, type VerifyResult } from "./verifier";

export { healthyMain };
export type SchoolDomain = typeof schoolDomains.$inferSelect;
type EventKind = typeof schoolDomainEvents.$inferInsert["kind"];

const DAY = 86_400_000;
/** DNS is rechecked every 10 minutes for this long, then the claim is marked failed (Check now starts it again). */
export const VERIFY_WINDOW_MS = 72 * 3_600_000;
/** An unverified claim ends after this long. */
export const CLAIM_MS = 30 * DAY;
/** Broken this long: the admins are told, once per incident. */
export const TELL_AFTER_MS = DAY;
/** Ownership record missing this long: the domain is released. */
export const TXT_RELEASE_MS = 14 * DAY;
/** Pointing somewhere else this long: the domain is released. */
export const POINTS_RELEASE_MS = 30 * DAY;
const CERT_WARN_MS = 14 * DAY;
/** The ownership record is missing: admins are warned on these days, before the release on day 14. */
export const TXT_WARN_DAYS = [1, 7] as const;
/** Shown when DNS could not be asked (SERVFAIL, timeout). Nothing else changes: not the state, not the clocks. */
export const COULD_NOT_CHECK = "We could not check just now. Nothing has changed. We will try again.";
const istDay = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
export const txtWarning = (n: number, releaseAt: Date) => `Ownership record missing for ${n} day${n === 1 ? "" : "s"}. The domain will be released on ${istDay(releaseAt)} unless the record is added.`;

/** ok = everything right; warning = ownership or certificate needs a look, the site still opens; broken = it does not point to us. Pure. */
export function healthOf(r: Pick<VerifyResult, "txtOk" | "pointsOk" | "httpsOk" | "certExpiresAt">, now: Date): "ok" | "warning" | "broken" {
  if (!r.pointsOk) return "broken";
  if (!r.txtOk || !r.httpsOk || (r.certExpiresAt && r.certExpiresAt.getTime() - now.getTime() < CERT_WARN_MS)) return "warning";
  return "ok";
}

/** What happens to an unverified claim after one DNS check. Pure. `failingSince` marks the start of a Check now on a failed claim. */
export function nextDomainState(d: Pick<SchoolDomain, "createdAt"> & { failingSince?: Date | null }, r: Pick<VerifyResult, "ok" | "error">, now: Date) {
  if (r.ok) return { status: "verified" as const, verifiedAt: now, lastCheckedAt: now, checkError: null };
  const expired = now.getTime() - (d.failingSince ?? d.createdAt).getTime() >= VERIFY_WINDOW_MS;
  return {
    status: expired ? ("failed" as const) : ("pending" as const),
    lastCheckedAt: now,
    checkError: expired ? `${r.error ?? "DNS records not found."} We stopped checking after 3 days. Fix the records and press Check now.` : (r.error ?? null),
  };
}

export interface Outcome {
  patch: Partial<typeof schoolDomains.$inferInsert>;
  events: { kind: EventKind; detail: string }[];
  tell: "problem" | "recovered" | null;
  /** The day (1 or 7) of the ownership-record warning to send now, or null. */
  txtWarn: 1 | 7 | null;
  /** Why the domain must be released now, or null. */
  release: string | null;
}

/** What one recheck of a verified domain changes, says and tells. Pure, with the clock passed in. */
export function recheckOutcome(d: Pick<SchoolDomain, "health" | "failingSince" | "txtMissingSince" | "toldAt" | "certExpiresAt" | "dnsProvider">, r: VerifyResult, now: Date, txtTold: ReadonlySet<number> = new Set()): Outcome {
  const health = healthOf(r, now);
  const failingSince = r.pointsOk ? null : (d.failingSince ?? now);
  const txtMissingSince = r.txtOk ? null : (d.txtMissingSince ?? now);
  const was = d.health ?? "ok";
  const events: Outcome["events"] = [];
  if (was === "ok" && health !== "ok") events.push({ kind: "failing", detail: r.error ?? "The certificate needs attention." });
  if (was !== "ok" && health === "ok") events.push({ kind: "recovered", detail: "All records are right again." });

  let toldAt = d.toldAt, tell: Outcome["tell"] = null;
  if (failingSince && !toldAt && now.getTime() - failingSince.getTime() >= TELL_AFTER_MS) { toldAt = now; tell = "problem"; }
  else if (health === "ok" && toldAt) { toldAt = null; tell = "recovered"; }

  const missing = txtMissingSince ? now.getTime() - txtMissingSince.getTime() : 0;
  const txtWarn = !txtMissingSince ? null : missing >= 7 * DAY && !txtTold.has(7) ? 7 : missing >= DAY && missing < 7 * DAY && !txtTold.has(1) ? 1 : null;
  const release = txtMissingSince && now.getTime() - txtMissingSince.getTime() >= TXT_RELEASE_MS ? "The ownership record has been missing for 14 days."
    : failingSince && now.getTime() - failingSince.getTime() >= POINTS_RELEASE_MS ? "The domain has pointed somewhere else for 30 days." : null;
  return {
    patch: {
      health, records: r.records, lastCheckedAt: now, checkError: r.error ?? null, failingSince, txtMissingSince, toldAt,
      certExpiresAt: r.certExpiresAt ?? (r.pointsOk ? null : d.certExpiresAt), dnsProvider: r.provider,
    },
    events, tell, txtWarn, release,
  };
}

const isUnique = (err: unknown) => ((err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code) === "23505";

export async function addEvent(tx: Tx, d: Pick<SchoolDomain, "id" | "schoolId" | "hostname">, kind: EventKind, detail: string | null, byName: string | null = null) {
  await tx.insert(schoolDomainEvents).values({ schoolId: d.schoolId, domainId: d.id, hostname: d.hostname, kind, detail, byName });
}

/** Tell the school's admins, in the same transaction. */
async function tell(tx: Tx, d: Pick<SchoolDomain, "id" | "schoolId" | "hostname">, title: string, body: string, action = true) {
  const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.schoolId, d.schoolId), eq(users.role, "admin"), eq(users.status, "active")));
  await NotificationWriter.insert(tx, d.schoolId, admins.map((a) => ({
    userId: a.id, topic: "domain.problem" as const, title, body, href: `/app/domains/${d.id}`, subject: { type: "domain", id: d.id }, groupKey: `domain:${d.id}`, action, urgent: action,
  })));
}

const LOST = (host: string) => `Another school proved it owns ${host} first, so this claim has ended. If the domain is yours, contact support.`;

/** The platform side of domains: checks DNS and the certificate, and saves what it finds. Runs in the worker and behind "Check now". */
export class DomainVerificationJob {
  private readonly verifier: DomainVerifier;
  constructor(
    dns: DnsResolver = services().dns,
    private readonly rootDomain = env().ROOT_DOMAIN,
    private readonly now: () => Date = () => new Date(),
    tls: TlsProbe = services().tls,
    ip: string = sitesIp(),
  ) { this.verifier = new DomainVerifier(dns, tls, ip); }

  /** Check one domain, whatever its state, and save the outcome (platform access: the only writer of status and health). */
  async check(d: SchoolDomain, by: string | null = null): Promise<SchoolDomain> {
    return d.status === "verified" ? this.recheck(d, by) : this.claim(d, by);
  }

  /** An unverified claim: verify it, keep it waiting, or fail it after 72 hours. */
  async claim(d: SchoolDomain, by: string | null = null): Promise<SchoolDomain> {
    const now = this.now();
    const r = await this.ask(d);
    if (!r) return this.unknown(d);
    // A person pressing Check now on a failed claim gives it a fresh 72 hours: failed -> pending.
    const restart = d.status === "failed" && by !== null;
    const state = nextDomainState(restart ? { ...d, failingSince: now } : d, r, now);
    const saved = await withConsole(async (tx) => {
      if (state.status !== "verified") {
        const [row] = await tx.update(schoolDomains).set({ ...state, records: r.records, dnsProvider: r.provider, ...(restart ? { failingSince: now } : {}) })
          .where(and(eq(schoolDomains.id, d.id), ne(schoolDomains.status, "verified"))).returning();
        if (row && state.status === "failed" && d.status !== "failed") await addEvent(tx, d, "failed", state.checkError, by);
        return row;
      }
      let won: SchoolDomain | undefined;
      try {
        // A savepoint: the unique index on verified names decides a race, and losing it must not poison the outer transaction.
        won = (await tx.transaction(async (sp) => sp.update(schoolDomains).set({
          ...state, health: healthOf(r, now), records: r.records, certExpiresAt: r.certExpiresAt, dnsProvider: r.provider, failingSince: null, txtMissingSince: null, toldAt: null,
          // A claim that is already verified (another check got there first) or gone is left alone: nothing below runs for it.
        }).where(and(eq(schoolDomains.id, d.id), ne(schoolDomains.status, "verified"))).returning()))[0];
      } catch (err) {
        if (!isUnique(err)) throw err;
        const [lost] = await tx.update(schoolDomains).set({ status: "failed", lastCheckedAt: now, checkError: LOST(d.hostname), records: r.records }).where(eq(schoolDomains.id, d.id)).returning();
        await addEvent(tx, d, "lost", LOST(d.hostname), by);
        await tell(tx, d, `${d.hostname} was claimed by another school`, LOST(d.hostname));
        return lost;
      }
      if (!won) return (await tx.select().from(schoolDomains).where(eq(schoolDomains.id, d.id)))[0];
      await addEvent(tx, d, "verified", "Ownership and the address are proven.", by);
      await this.promoteFirst(tx, won);
      // Every other school that tried the same name hears it now, not at its next check.
      const rivals = await tx.update(schoolDomains).set({ status: "failed", checkError: LOST(d.hostname) })
        .where(and(eq(schoolDomains.hostname, d.hostname), ne(schoolDomains.schoolId, d.schoolId), ne(schoolDomains.status, "verified"))).returning();
      for (const x of rivals) { await addEvent(tx, x, "lost", LOST(d.hostname)); await tell(tx, x, `${x.hostname} was claimed by another school`, LOST(d.hostname)); }
      return (await tx.select().from(schoolDomains).where(eq(schoolDomains.id, d.id)))[0];
    });
    forgetHost(d.hostname);
    return saved ?? d;
  }

  /** A verified domain: save each record's result, tell about long breakage, release when it has been gone too long. */
  async recheck(d: SchoolDomain, by: string | null = null): Promise<SchoolDomain> {
    const now = this.now();
    const r = await this.ask(d);
    if (!r) return this.unknown(d);
    const saved = await withConsole(async (tx) => {
      const told = d.txtMissingSince
        ? new Set((await tx.select({ detail: schoolDomainEvents.detail }).from(schoolDomainEvents)
          .where(and(eq(schoolDomainEvents.domainId, d.id), eq(schoolDomainEvents.kind, "failing"), like(schoolDomainEvents.detail, "Ownership record missing for%"), gte(schoolDomainEvents.createdAt, d.txtMissingSince)))).flatMap((e) => TXT_WARN_DAYS.filter((n) => e.detail?.startsWith(`Ownership record missing for ${n} day`))))
        : new Set<number>();
      const o = recheckOutcome(d, r, now, told);
      const [row] = await tx.update(schoolDomains).set(o.patch).where(and(eq(schoolDomains.id, d.id), eq(schoolDomains.status, "verified"))).returning();
      if (!row) return d;
      if (o.txtWarn) {
        const why = txtWarning(o.txtWarn, new Date(row.txtMissingSince!.getTime() + TXT_RELEASE_MS));
        await addEvent(tx, d, "failing", why, by);
        await tell(tx, d, `${d.hostname}: ownership record missing`, `${why} Open the page to see the record to add.`);
      }
      await this.promoteFirst(tx, row);
      for (const e of o.events) await addEvent(tx, d, e.kind, e.detail, by);
      if (o.tell === "problem") await tell(tx, d, `${d.hostname} is not reaching your school`, `${r.error ?? "The domain has a problem."} Open the page to see which record to fix.`);
      if (o.tell === "recovered") await tell(tx, d, `${d.hostname} works again`, "All records are right again.", false);
      return o.release ? this.releaseIn(tx, row, o.release, null) : ((await tx.select().from(schoolDomains).where(eq(schoolDomains.id, d.id)))[0] ?? row);
    });
    forgetHost(d.hostname);
    return saved;
  }

  /** DNS and the certificate, or null when DNS could not be asked (an unknown is not "no record"). */
  private async ask(d: SchoolDomain): Promise<VerifyResult | null> {
    try { return await this.verifier.verify(d.hostname, d.verifyToken, this.rootDomain); } catch (err) {
      if (err instanceof DnsUnavailableError) return null;
      throw err;
    }
  }

  /** Could not ask: say so, and change nothing else (no state, no clocks, no events). */
  private async unknown(d: SchoolDomain): Promise<SchoolDomain> {
    const [row] = await withConsole((tx) => tx.update(schoolDomains).set({ checkError: COULD_NOT_CHECK }).where(eq(schoolDomains.id, d.id)).returning());
    return row ?? d;
  }

  /** The free <slug> address is main from signup. The first custom domain that is healthy, certificate included, takes over; one that is not yet waits for a later check. */
  private async promoteFirst(tx: Tx, d: SchoolDomain) {
    if (d.status !== "verified" || !healthyMain(d, this.now())) return;
    const [hasPrimary] = await tx.select({ id: schoolDomains.id }).from(schoolDomains)
      .where(and(eq(schoolDomains.schoolId, d.schoolId), eq(schoolDomains.kind, "custom"), eq(schoolDomains.isPrimary, true))).limit(1);
    if (hasPrimary) return;
    await tx.update(schoolDomains).set({ isPrimary: false }).where(eq(schoolDomains.schoolId, d.schoolId));
    await tx.update(schoolDomains).set({ isPrimary: true }).where(eq(schoolDomains.id, d.id));
  }

  /** Stop serving a domain: status failed, main moves to the free address, the school is told. */
  async release(d: SchoolDomain, reason: string, by: string | null): Promise<SchoolDomain> {
    const row = await withConsole((tx) => this.releaseIn(tx, d, reason, by));
    forgetHost(d.hostname);
    return row;
  }

  private async releaseIn(tx: Tx, d: SchoolDomain, reason: string, by: string | null): Promise<SchoolDomain> {
    const [row] = await tx.update(schoolDomains).set({
      status: "failed", health: null, isPrimary: false, failingSince: null, txtMissingSince: null, toldAt: null, checkError: reason, lastCheckedAt: this.now(),
    }).where(eq(schoolDomains.id, d.id)).returning();
    if (d.isPrimary) await tx.update(schoolDomains).set({ isPrimary: true }).where(and(eq(schoolDomains.schoolId, d.schoolId), eq(schoolDomains.kind, "subdomain")));
    await addEvent(tx, d, "released", reason, by);
    await tell(tx, d, `${d.hostname} no longer opens your school`, `${reason} Your free address is the main address again. Fix the records and press Check now to bring it back.`);
    return row ?? d;
  }

  /** Unverified claims older than 30 days end: the row goes, the name is free for anyone. */
  async endOldClaims(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - CLAIM_MS);
    return withConsole(async (tx) => {
      const old = await tx.delete(schoolDomains).where(and(eq(schoolDomains.kind, "custom"), isNull(schoolDomains.verifiedAt), ne(schoolDomains.status, "verified"), lt(schoolDomains.createdAt, cutoff))).returning();
      for (const d of old) {
        await addEvent(tx, d, "released", "The claim was not proven within 30 days and has ended.");
        await tell(tx, d, `${d.hostname} was not proven`, "The domain was not proven within 30 days, so the claim has ended. Add it again when you are ready.", false);
      }
      return old.length;
    });
  }

  private async each(rows: SchoolDomain[], fn: (d: SchoolDomain) => Promise<SchoolDomain>) {
    const out = { checked: 0, verified: 0, failed: 0, released: 0 };
    for (const d of rows) {
      try {
        const saved = await fn(d);
        out.checked++;
        if (d.status !== "verified" && saved.status === "verified") out.verified++;
        if (d.status !== "failed" && saved.status === "failed") out[d.status === "verified" ? "released" : "failed"]++;
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "domain check failed", domain: d.hostname, err: String(err) }));
      }
    }
    return out;
  }

  /** "domains.verify-pending", every 10 minutes: waiting claims, verified domains that are not healthy, and ending old claims. */
  async run() {
    const rows = await withConsole((tx) => tx.select().from(schoolDomains).where(and(eq(schoolDomains.kind, "custom"),
      or(eq(schoolDomains.status, "pending"), and(eq(schoolDomains.status, "verified"), inArray(schoolDomains.health, ["warning", "broken"]))))).orderBy(asc(schoolDomains.createdAt)));
    const out = await this.each(rows, (d) => this.check(d));
    return { ...out, ended: await this.endOldClaims() };
  }

  /** "domains.recheck", daily: every verified custom domain, whatever its health. */
  async recheckAll() {
    const rows = await withConsole((tx) => tx.select().from(schoolDomains).where(and(eq(schoolDomains.kind, "custom"), eq(schoolDomains.status, "verified"), isNotNull(schoolDomains.verifiedAt))).orderBy(asc(schoolDomains.createdAt)));
    return this.each(rows, (d) => this.recheck(d));
  }
}

export type { DomainRecordCheck };
