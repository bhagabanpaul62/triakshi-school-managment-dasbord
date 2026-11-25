import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { env } from "@smw/config";
import { closeDb, schoolDomainEvents, schoolDomains, withConsole } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { notifications } from "@smw/feature-notifications/schema";
import { FakeDnsResolver, FakeTlsProbe } from "@smw/integrations";
import { POINTS_RELEASE_MS, TELL_AFTER_MS, TXT_RELEASE_MS, CLAIM_MS, DomainVerificationJob, healthOf, recheckOutcome, type SchoolDomain } from "./monitor";
import type { VerifyResult } from "./verifier";

const H = 3_600_000, DAY = 24 * H;
const IP = "203.0.113.10";
const t0 = new Date("2026-06-01T06:00:00Z");
const after = (ms: number) => new Date(t0.getTime() + ms);

const dns = new FakeDnsResolver();
const tls = new FakeTlsProbe();
const job = (now: Date) => new DomainVerificationJob(dns, env().ROOT_DOMAIN, () => now, tls, IP);
let a: TestSchool, b: TestSchool;
let n = 0;

const insert = async (s: TestSchool, hostname: string, extra: Partial<typeof schoolDomains.$inferInsert> = {}) =>
  withConsole(async (tx) => (await tx.insert(schoolDomains).values({ schoolId: s.id, hostname, kind: "custom", status: "pending", verifyToken: `tok${n++}`, ...extra }).returning())[0]!);
const row = async (id: string) => (await withConsole((tx) => tx.select().from(schoolDomains).where(eq(schoolDomains.id, id))))[0]!;
const kinds = async (id: string) => (await withConsole((tx) => tx.select().from(schoolDomainEvents).where(eq(schoolDomainEvents.domainId, id)).orderBy(schoolDomainEvents.createdAt))).map((e) => e.kind);
const told = (s: TestSchool, id: string) => withConsole((tx) => tx.select().from(notifications).where(and(eq(notifications.schoolId, s.id), eq(notifications.subjectId, id), eq(notifications.topic, "domain.problem"))));
const good = (d: { hostname: string; verifyToken: string }, apex = false) => {
  dns.records.txt[`_smw-verify.${d.hostname}`] = [`smw-verify=${d.verifyToken}`];
  if (apex) dns.records.a[d.hostname] = [IP]; else dns.records.cname[d.hostname] = [`sites.${env().ROOT_DOMAIN}`];
  tls.results[d.hostname] = { ok: true, issuer: "Test CA", expiresAt: after(90 * DAY) };
};
const unpoint = (d: { hostname: string }) => { delete dns.records.cname[d.hostname]; delete dns.records.a[d.hostname]; };
/** A live, healthy domain, as the platform leaves it. */
const live = async (s: TestSchool, hostname: string) => {
  const d = await insert(s, hostname);
  good(d);
  return job(t0).claim(d);
};

beforeAll(async () => { ({ a, b } = await createSchoolPair(["domains"], "m")); });
afterAll(closeDb);

const r = (o: Partial<VerifyResult>): VerifyResult => ({ records: [], txtOk: true, pointsOk: true, httpsOk: true, ok: true, certExpiresAt: after(90 * DAY), provider: "other", ...o });
const base = { health: "ok" as const, failingSince: null, txtMissingSince: null, toldAt: null, certExpiresAt: null, dnsProvider: null };

describe("health and the clocks (pure)", () => {
  it("ok, warning and broken", () => {
    expect(healthOf(r({}), t0)).toBe("ok");
    expect(healthOf(r({ txtOk: false }), t0)).toBe("warning");
    expect(healthOf(r({ httpsOk: false }), t0)).toBe("warning");
    expect(healthOf(r({ certExpiresAt: after(13 * DAY) }), t0)).toBe("warning");
    expect(healthOf(r({ pointsOk: false, ok: false }), t0)).toBe("broken");
  });

  it("D4: a verified domain whose DNS breaks is noticed, told after 24 hours once, and told when it recovers", () => {
    const broken = r({ pointsOk: false, ok: false, error: "gone" });
    const first = recheckOutcome(base, broken, t0);
    expect(first.patch).toMatchObject({ health: "broken", failingSince: t0 });
    expect(first.events.map((e) => e.kind)).toEqual(["failing"]);
    expect(first.tell).toBeNull();
    const early = recheckOutcome({ ...base, health: "broken", failingSince: t0 }, broken, after(TELL_AFTER_MS - 1));
    expect(early.tell).toBeNull();
    const due = recheckOutcome({ ...base, health: "broken", failingSince: t0 }, broken, after(TELL_AFTER_MS));
    expect(due.tell).toBe("problem");
    expect(due.patch.toldAt).toEqual(after(TELL_AFTER_MS));
    const again = recheckOutcome({ ...base, health: "broken", failingSince: t0, toldAt: after(TELL_AFTER_MS) }, broken, after(TELL_AFTER_MS + H));
    expect(again.tell).toBeNull();
    expect(again.events).toEqual([]);
    const back = recheckOutcome({ ...base, health: "broken", failingSince: t0, toldAt: after(TELL_AFTER_MS) }, r({}), after(2 * DAY));
    expect(back.tell).toBe("recovered");
    expect(back.patch).toMatchObject({ health: "ok", failingSince: null, toldAt: null });
    expect(back.events.map((e) => e.kind)).toEqual(["recovered"]);
  });

  it("a recovery nobody was told about stays quiet", () => {
    expect(recheckOutcome({ ...base, health: "broken", failingSince: t0 }, r({}), after(H)).tell).toBeNull();
  });

  it("releases after 14 days without the TXT and after 30 days pointing elsewhere, not a moment sooner", () => {
    const noTxt = r({ txtOk: false, ok: false });
    expect(recheckOutcome({ ...base, health: "warning", txtMissingSince: t0 }, noTxt, after(TXT_RELEASE_MS - 1)).release).toBeNull();
    expect(recheckOutcome({ ...base, health: "warning", txtMissingSince: t0 }, noTxt, after(TXT_RELEASE_MS)).release).toMatch(/14 days/);
    const away = r({ pointsOk: false, ok: false });
    expect(recheckOutcome({ ...base, health: "broken", failingSince: t0 }, away, after(POINTS_RELEASE_MS - 1)).release).toBeNull();
    expect(recheckOutcome({ ...base, health: "broken", failingSince: t0 }, away, after(POINTS_RELEASE_MS)).release).toMatch(/30 days/);
  });

  it("the TXT clock resets when the record comes back", () => {
    expect(recheckOutcome({ ...base, health: "warning", txtMissingSince: t0 }, r({}), after(10 * DAY)).patch.txtMissingSince).toBeNull();
  });
});

describe("rechecking live domains (injected clock)", () => {
  it("saves each record's result, and a healthy domain stays ok", async () => {
    const d = await live(a, "www.m-ok.in");
    expect(d).toMatchObject({ status: "verified", health: "ok", dnsProvider: "other" });
    expect(d.records.map((x) => [x.key, x.ok])).toEqual([["txt", true], ["cname", true], ["https", true]]);
    expect(d.certExpiresAt).toEqual(after(90 * DAY));
    const again = await job(after(DAY)).recheck(d);
    expect(again.health).toBe("ok");
    expect(await kinds(d.id)).toEqual(["verified"]);
  });

  it("broken DNS is seen, told once after 24 hours, and the recovery is told", async () => {
    const d = await live(a, "www.m-break.in");
    unpoint(d);
    const broke = await job(after(H)).recheck(d);
    expect(broke).toMatchObject({ health: "broken", failingSince: after(H), toldAt: null });
    expect(await told(a, d.id)).toHaveLength(0);

    const day = await job(after(H + TELL_AFTER_MS)).recheck(broke);
    expect(day.toldAt).toEqual(after(H + TELL_AFTER_MS));
    const once = await told(a, d.id);
    expect(once).toHaveLength(1);
    expect(once[0]).toMatchObject({ count: 1, action: true });
    expect(once[0]!.href).toBe(`/app/domains/${d.id}`);

    await job(after(H + TELL_AFTER_MS + 10 * 60_000)).recheck(day);
    expect((await told(a, d.id))[0]!.count).toBe(1);
    expect(await told(b, d.id)).toHaveLength(0);

    good(d);
    const fixed = await job(after(3 * DAY)).recheck(await row(d.id));
    expect(fixed).toMatchObject({ health: "ok", failingSince: null, toldAt: null });
    expect((await told(a, d.id))[0]).toMatchObject({ count: 2, title: "www.m-break.in works again" });
    expect(await kinds(d.id)).toEqual(["verified", "failing", "recovered"]);
  });

  it("releases a domain whose TXT is missing for 14 days: stops serving, main moves to the free address, school told", async () => {
    const sub = await insert(a, `a-m-${n}.${env().ROOT_DOMAIN}`, { kind: "subdomain", status: "verified", isPrimary: true });
    const d = await live(a, "www.m-txt.in");
    await withConsole(async (tx) => {
      await tx.update(schoolDomains).set({ isPrimary: false }).where(eq(schoolDomains.schoolId, a.id));
      await tx.update(schoolDomains).set({ isPrimary: true }).where(eq(schoolDomains.id, d.id));
    });
    delete dns.records.txt[`_smw-verify.${d.hostname}`];
    const first = await job(after(H)).recheck(await row(d.id));
    expect(first).toMatchObject({ status: "verified", health: "warning", txtMissingSince: after(H) });
    const gone = await job(after(H + TXT_RELEASE_MS)).recheck(await row(d.id));
    expect(gone).toMatchObject({ status: "failed", isPrimary: false, health: null });
    expect(gone.checkError).toMatch(/14 days/);
    expect((await row(sub.id)).isPrimary).toBe(true);
    expect((await row(d.id)).isPrimary).toBe(false);
    expect(await kinds(d.id)).toEqual(["verified", "failing", "failing", "released"]);
    expect((await told(a, d.id))[0]!.title).toContain("no longer opens your school");
    await withConsole((tx) => tx.delete(schoolDomains).where(eq(schoolDomains.id, sub.id)));
  });

  it("releases a domain pointing elsewhere for 30 days", async () => {
    const d = await live(a, "www.m-away.in");
    unpoint(d);
    const first = await job(after(H)).recheck(d);
    expect((await job(after(H + POINTS_RELEASE_MS - 1000)).recheck(first)).status).toBe("verified");
    const gone = await job(after(H + POINTS_RELEASE_MS)).recheck(await row(d.id));
    expect(gone.status).toBe("failed");
    expect(gone.checkError).toMatch(/30 days/);
  });

  it("the 10-minute job rechecks failing domains and leaves healthy ones; the daily job checks every live one", async () => {
    const healthy = await live(a, "www.m-job-ok.in");
    const sick = await live(a, "www.m-job-sick.in");
    unpoint(sick);
    await job(after(H)).recheck(sick);
    good(sick);
    await job(after(2 * H)).run();
    expect((await row(sick.id)).health).toBe("ok");
    expect((await row(healthy.id)).lastCheckedAt).toEqual(t0);
    unpoint(healthy);
    const out = await job(after(DAY)).recheckAll();
    expect(out.checked).toBeGreaterThanOrEqual(2);
    expect((await row(healthy.id)).health).toBe("broken");
  });

  it("a console release stops serving the domain and records who and why", async () => {
    const d = await live(a, "www.m-console.in");
    const out = await job(after(H)).release(d, "Asked by the owner of the domain.", "Support Sam");
    expect(out.status).toBe("failed");
    const ev = await withConsole((tx) => tx.select().from(schoolDomainEvents).where(and(eq(schoolDomainEvents.domainId, d.id), eq(schoolDomainEvents.kind, "released"))));
    expect(ev[0]).toMatchObject({ detail: "Asked by the owner of the domain.", byName: "Support Sam" });
  });
});

describe("ownership record warnings, unknown lookups, guards, certificates, staff release", () => {
  const missing = { ...base, health: "warning" as const, txtMissingSince: t0 };
  it("2: warns on day 1 and day 7, once each, before the release on day 14", () => {
    const noTxt = r({ txtOk: false, ok: false });
    expect(recheckOutcome(missing, noTxt, after(DAY - 1)).txtWarn).toBeNull();
    expect(recheckOutcome(missing, noTxt, after(DAY)).txtWarn).toBe(1);
    expect(recheckOutcome(missing, noTxt, after(DAY + H), new Set([1])).txtWarn).toBeNull();
    expect(recheckOutcome(missing, noTxt, after(7 * DAY), new Set([1])).txtWarn).toBe(7);
    expect(recheckOutcome(missing, noTxt, after(8 * DAY), new Set([1, 7])).txtWarn).toBeNull();
  });

  it("2: the warnings reach the admins with the release date, once each", async () => {
    const d = await live(a, "www.m-warn.in");
    delete dns.records.txt[`_smw-verify.${d.hostname}`];
    await job(after(H)).recheck(d);
    for (const t of [after(H + DAY), after(H + DAY + 10 * 60_000), after(H + 7 * DAY), after(H + 8 * DAY)]) await job(t).recheck(await row(d.id));
    const ev = (await withConsole((tx) => tx.select().from(schoolDomainEvents).where(eq(schoolDomainEvents.domainId, d.id)))).filter((e) => e.detail?.startsWith("Ownership record missing"));
    expect(ev.map((e) => e.detail!.match(/for (\d+) days?/)![1])).toEqual(["1", "7"]);
    expect(ev[0]!.detail).toContain("15 Jun 2026");
    expect((await told(a, d.id))[0]!.count).toBe(2);
  });

  it("3: a lookup that could not be asked changes nothing: not the state, not the clocks, not the events", async () => {
    const d = await live(a, "www.m-unsure.in");
    unpoint(d);
    const broke = await job(after(H)).recheck(d);
    expect(broke.health).toBe("broken");
    dns.down.add(`_smw-verify.${d.hostname}`);
    const shown = await job(after(2 * H)).recheck(broke);
    dns.down.delete(`_smw-verify.${d.hostname}`);
    expect(shown.checkError).toMatch(/could not check just now/);
    expect(shown).toMatchObject({ health: "broken", failingSince: broke.failingSince, lastCheckedAt: broke.lastCheckedAt, txtMissingSince: null, status: "verified" });
    expect(await kinds(d.id)).toEqual(["verified", "failing"]);
  });

  it("3: an unknown never fails a pending claim, even after 72 hours", async () => {
    const d = await insert(a, "www.m-unsure2.in");
    dns.down.add(`_smw-verify.${d.hostname}`);
    const out = await job(after(5 * DAY)).claim(d);
    dns.down.delete(`_smw-verify.${d.hostname}`);
    expect(out).toMatchObject({ status: "pending", lastCheckedAt: null });
    expect(await kinds(d.id)).toEqual([]);
  });

  it("4: a claim that is already verified, or gone, is left alone: no second verified event, no writes", async () => {
    const d = await live(a, "www.m-twice.in");
    await job(after(H)).claim({ ...d, status: "pending", verifiedAt: null });
    expect(await kinds(d.id)).toEqual(["verified"]);
    const ghost = await insert(a, "www.m-ghost.in");
    await withConsole((tx) => tx.delete(schoolDomains).where(eq(schoolDomains.id, ghost.id)));
    good(ghost);
    await job(t0).claim(ghost);
    expect(await kinds(ghost.id)).toEqual([]);
  });

  it("1: a domain without a working certificate does not become main; a later check that sees it does", async () => {
    const c = await createSchoolPair(["domains"], "mc");
    const d = await insert(c.a, "www.m-cert.in");
    good(d);
    tls.results[d.hostname] = { ok: false, issuer: null, expiresAt: null, error: "No certificate yet." };
    const first = await job(t0).claim(d);
    expect(first).toMatchObject({ status: "verified", health: "warning", isPrimary: false });
    tls.results[d.hostname] = { ok: true, issuer: "CA", expiresAt: after(90 * DAY) };
    await job(after(H)).recheck(first);
    expect((await row(d.id)).isPrimary).toBe(true);
  });

  it("5: Triakshi's release cannot be undone by the school; allowing it again lifts the block", async () => {
    const { DomainService } = await import("./service");
    const d = await live(a, "www.m-staff.in");
    await job(after(H)).release(d, "Asked by the real owner.", "Support Sam");
    const svc = new DomainService(a.as.admin, job(after(2 * H)));
    await expect(svc.checkNow(d.id)).rejects.toThrow(/Released by Triakshi: Asked by the real owner\. Ask support/);
    expect(await svc.staffBlock(d.id)).toBe("Asked by the real owner.");
    await withConsole((tx) => tx.insert(schoolDomainEvents).values({ schoolId: a.id, domainId: d.id, hostname: d.hostname, kind: "recovered", detail: "allowed", byName: "Support Sam" }));
    expect(await svc.staffBlock(d.id)).toBeNull();
    expect((await svc.checkNow(d.id)).status).toBe("verified");
  });

  it("5: an automatic release is not a staff release", async () => {
    const { DomainService } = await import("./service");
    const d = await live(a, "www.m-auto.in");
    await job(after(H)).release(d, "Gone for 14 days.", null);
    expect(await new DomainService(a.as.admin, job(after(2 * H))).staffBlock(d.id)).toBeNull();
  });
});

describe("claims", () => {
  it("D3: an unproven claim blocks nobody: two schools can both hold the same pending name", async () => {
    const x = await insert(a, "www.m-both.in"), y = await insert(b, "www.m-both.in");
    expect([x.status, y.status]).toEqual(["pending", "pending"]);
  });

  it("the first to prove it gets it; the other claim is told it lost, with a plain sentence", async () => {
    const x = await insert(a, "www.m-race.in"), y = await insert(b, "www.m-race.in");
    dns.records.txt["_smw-verify.www.m-race.in"] = [`smw-verify=${x.verifyToken}`, `smw-verify=${y.verifyToken}`];
    dns.records.cname["www.m-race.in"] = [`sites.${env().ROOT_DOMAIN}`];
    tls.results["www.m-race.in"] = { ok: true, issuer: "CA", expiresAt: after(90 * DAY) };
    expect((await job(t0).claim(x)).status).toBe("verified");
    const lost = await row(y.id);
    expect(lost.status).toBe("failed");
    expect(lost.checkError).toContain("Another school proved it owns www.m-race.in first");
    expect(await kinds(y.id)).toEqual(["lost"]);
    expect(await told(b, y.id)).toHaveLength(1);
    expect(await told(a, y.id)).toHaveLength(0);
  });

  it("when the other school's check lands afterwards, the unique index decides: the loser is failed with `lost`", async () => {
    const x = await live(a, "www.m-late.in");
    const y = await insert(b, "www.m-late.in");
    dns.records.txt["_smw-verify.www.m-late.in"] = [`smw-verify=${x.verifyToken}`, `smw-verify=${y.verifyToken}`];
    const out = await job(after(H)).claim(y);
    expect(out.status).toBe("failed");
    expect(out.checkError).toContain("Another school proved it owns");
    expect((await row(x.id)).status).toBe("verified");
    expect(await kinds(y.id)).toEqual(["lost"]);
    expect(await told(b, y.id)).toHaveLength(1);
  });

  it("D5: a bare domain with only its TXT does not go live", async () => {
    const d = await insert(a, "m-bare.in");
    dns.records.txt["_smw-verify.m-bare.in"] = [`smw-verify=${d.verifyToken}`];
    const out = await job(t0).claim(d);
    expect(out.status).toBe("pending");
    expect(out.checkError).toContain(IP);
    dns.records.a["m-bare.in"] = [IP];
    tls.results["m-bare.in"] = { ok: true, issuer: "CA", expiresAt: after(90 * DAY) };
    expect((await job(t0).claim(out)).status).toBe("verified");
  });

  it("an unverified claim ends after 30 days: the row goes and the school is told", async () => {
    const old = await insert(a, "www.m-old.in", { createdAt: new Date(Date.now() - CLAIM_MS - DAY) });
    const fresh = await insert(a, "www.m-fresh.in");
    const failedOld = await insert(a, "www.m-oldfailed.in", { status: "failed", createdAt: new Date(Date.now() - CLAIM_MS - DAY) });
    const ended = await new DomainVerificationJob(dns, env().ROOT_DOMAIN, () => new Date(), tls, IP).endOldClaims();
    expect(ended).toBeGreaterThanOrEqual(2);
    for (const gone of [old, failedOld]) expect(await withConsole((tx) => tx.select().from(schoolDomains).where(eq(schoolDomains.id, gone.id)))).toHaveLength(0);
    expect((await row(fresh.id)).status).toBe("pending");
    expect(await kinds(old.id)).toEqual(["released"]);
  });

  it("a released domain that was once verified is not deleted by the claim clock", async () => {
    const d = await live(a, "www.m-kept.in");
    await withConsole((tx) => tx.update(schoolDomains).set({ createdAt: new Date(Date.now() - CLAIM_MS - DAY) }).where(eq(schoolDomains.id, d.id)));
    await job(t0).release(d, "test", null);
    await new DomainVerificationJob(dns, env().ROOT_DOMAIN, () => new Date(), tls, IP).endOldClaims();
    expect((await row(d.id)).status).toBe("failed");
  });
});

export type { SchoolDomain };
