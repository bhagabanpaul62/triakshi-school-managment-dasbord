import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { env } from "@smw/config";
import { closeDb, plans, schoolDomainEvents, schoolDomains, schools, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, LimitError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { FakeDnsResolver, FakeTlsProbe } from "@smw/integrations";
import { isApex } from "./hostname";
import { DomainService, DomainVerificationJob, VERIFY_WINDOW_MS, nextDomainState } from "./service";

let a: TestSchool, b: TestSchool;
const dns = new FakeDnsResolver();
const tls = new FakeTlsProbe();
const IP = "203.0.113.10";
const sites = () => `sites.${env().ROOT_DOMAIN}`;
const job = (now = new Date()) => new DomainVerificationJob(dns, env().ROOT_DOMAIN, () => now, tls, IP);
const svc = (s: TestSchool, role: "admin" | "teacher" = "admin", now?: Date) => new DomainService(s.as[role], job(now));
const row = async (id: string) => (await withConsole((tx) => tx.select().from(schoolDomains).where(eq(schoolDomains.id, id))))[0]!;
const point = (d: { hostname: string; verifyToken: string }) => {
  dns.records.txt[`_smw-verify.${d.hostname}`] = [`smw-verify=${d.verifyToken}`];
  if (isApex(d.hostname)) dns.records.a[d.hostname] = [IP]; else dns.records.cname[d.hostname] = [sites()];
  tls.results[d.hostname] = { ok: true, issuer: "Test CA", expiresAt: new Date(Date.now() + 80 * 86_400_000) };
};
const events = (id: string) => withConsole((tx) => tx.select().from(schoolDomainEvents).where(eq(schoolDomainEvents.domainId, id)));

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["domains"]));
  await withConsole(async (tx) => {
    const [plan] = await tx.insert(plans).values({ key: "pro", name: "Pro", studentCap: 1000, priceAnnualPaise: 1, priceMonthlyPaise: 1, limits: { customDomain: true } }).returning();
    await tx.update(schools).set({ planId: plan!.id }).where(eq(schools.id, a.id));
  });
});
afterAll(closeDb);

describe("nextDomainState", () => {
  const created = new Date("2026-01-01T00:00:00Z");
  const fail = { ok: false, error: "nope" };
  it("verified on success", () => expect(nextDomainState({ createdAt: created }, { ok: true }, new Date(created.getTime() + 1000)).status).toBe("verified"));
  it("stays pending inside 72 hours, fails at 72 hours", () => {
    expect(nextDomainState({ createdAt: created }, fail, new Date(created.getTime() + VERIFY_WINDOW_MS - 1)).status).toBe("pending");
    expect(nextDomainState({ createdAt: created }, fail, new Date(created.getTime() + VERIFY_WINDOW_MS)).status).toBe("failed");
  });
});

describe("DomainService", () => {
  it("adds a pending domain with a token and lower-cases it", async () => {
    const d = await svc(a).add({ hostname: "WWW.Alpha-School.in" });
    expect(d).toMatchObject({ hostname: "www.alpha-school.in", status: "pending", kind: "custom" });
    expect(d.verifyToken).toHaveLength(24);
    const i = await svc(a).instructions(d.id);
    expect(i.records[0]).toEqual({ key: "txt", short: "_smw-verify.www", type: "TXT", name: "_smw-verify.www.alpha-school.in", value: `smw-verify=${d.verifyToken}` });
  });

  it("validates the hostname and refuses duplicates", async () => {
    await expect(svc(a).add({ hostname: "https://x.school.in" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc(a).add({ hostname: `x.${env().ROOT_DOMAIN}` })).rejects.toBeInstanceOf(ValidationError);
    await svc(a).add({ hostname: "dup.school.in" });
    await expect(svc(a).add({ hostname: "dup.school.in" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("only admins; teachers cannot even read", async () => {
    await expect(svc(a, "teacher").add({ hostname: "t.school.in" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(a, "teacher").list()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is gated by the plan", async () => {
    expect((await svc(b).planAllows()).allowed).toBe(false);
    await expect(svc(b).add({ hostname: "www.beta.in" })).rejects.toBeInstanceOf(LimitError);
    expect((await svc(a).planAllows()).allowed).toBe(true);
  });

  it("stops at 3 domains", async () => {
    const list = await svc(a).list();
    for (let i = list.length; i < 3; i++) await svc(a).add({ hostname: `fill${i}.school.in` });
    await expect(svc(a).add({ hostname: "fourth.school.in" })).rejects.toBeInstanceOf(LimitError);
    for (const d of await svc(a).list()) await svc(a).remove(d.id, d.hostname);
    expect(await svc(a).list()).toHaveLength(0);
  });

  it("checkNow: wrong DNS keeps it pending with an error; right DNS verifies and makes it main", async () => {
    const d = await svc(a).add({ hostname: "www.verify-me.in" });
    const miss = await svc(a).checkNow(d.id);
    expect(miss.status).toBe("pending");
    expect(miss.checkError).toContain("_smw-verify.www.verify-me.in");
    point(d);
    const done = await svc(a).checkNow(d.id);
    expect(done).toMatchObject({ status: "verified", checkError: null });
    expect(done.verifiedAt).toBeInstanceOf(Date);
    expect((await row(d.id)).isPrimary).toBe(true);
  });

  it("setPrimary needs a verified domain and keeps one main domain", async () => {
    const pending = await svc(a).add({ hostname: "www.second.in" });
    await expect(svc(a).setPrimary(pending.id)).rejects.toBeInstanceOf(ConflictError);
    point(pending);
    await svc(a).checkNow(pending.id);
    await svc(a).setPrimary(pending.id);
    const all = await svc(a).list();
    expect(all.filter((x) => x.isPrimary).map((x) => x.hostname)).toEqual(["www.second.in"]);
    await svc(a).remove(pending.id, pending.hostname);
    expect((await svc(a).list()).filter((x) => x.isPrimary).map((x) => x.hostname)).toEqual(["www.verify-me.in"]);
  });

  it("isolation: school B cannot see, check, move or remove school A's domains", async () => {
    const d = (await svc(a).list())[0]!;
    expect((await svc(b).list()).some((x) => x.id === d.id)).toBe(false);
    await expect(svc(b).remove(d.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc(b).checkNow(d.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc(b).setPrimary(d.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc(b).instructions(d.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the school role cannot mark a domain verified (insert trigger and column grants)", async () => {
    const { withSchool } = await import("@smw/db");
    const forced = await withSchool(a.id, async (tx) => {
      const [r] = await tx.insert(schoolDomains).values({ schoolId: a.id, hostname: "sneaky.school.in", status: "verified", verifiedAt: new Date(), verifyToken: "t" }).returning();
      return r!;
    });
    expect(forced.status).toBe("pending");
    expect(forced.verifiedAt).toBeNull();
    await expect(withSchool(a.id, (tx) => tx.update(schoolDomains).set({ status: "verified" }).where(eq(schoolDomains.id, forced.id)))).rejects.toThrow();
    await svc(a).remove(forced.id);
  });
});

describe("DomainVerificationJob", () => {
  beforeAll(async () => { for (const d of await svc(a).list()) await svc(a).remove(d.id, d.hostname); });
  it("verifies pending domains whose DNS is right, leaves others pending, fails after 72 hours", async () => {
    const good = await svc(a).add({ hostname: "www.job-good.in" });
    const wait = await svc(a).add({ hostname: "www.job-wait.in" });
    const late = await svc(a).add({ hostname: "www.job-late.in" });
    point(good);

    const now = new Date();
    await job(now).run();
    expect((await row(good.id)).status).toBe("verified");
    const waiting = await row(wait.id);
    expect(waiting.status).toBe("pending");
    expect(waiting.lastCheckedAt).toBeInstanceOf(Date);
    expect(waiting.checkError).toBeTruthy();

    const out = await job(new Date(now.getTime() + VERIFY_WINDOW_MS + 60_000)).run();
    expect(out.failed).toBeGreaterThanOrEqual(2);
    expect((await row(wait.id)).status).toBe("failed");
    expect((await row(late.id)).status).toBe("failed");
    expect((await row(good.id)).status).toBe("verified");
  });

  it("a failed domain can recover through Check now", async () => {
    const d = (await svc(a).list()).find((x) => x.hostname === "www.job-late.in")!;
    point(d);
    expect((await svc(a).checkNow(d.id)).status).toBe("verified");
  });
});

describe("main domain next to the free address", () => {
  beforeAll(async () => { for (const d of await svc(a).list()) await svc(a).remove(d.id, d.hostname); });
  it("a custom domain takes the main role from the free address, and gives it back when removed", async () => {
    const sub = await withConsole(async (tx) => (await tx.insert(schoolDomains).values({ schoolId: a.id, hostname: `a-${a.id.slice(0, 8)}.${env().ROOT_DOMAIN}`, kind: "subdomain", status: "verified", isPrimary: true, verifyToken: "x" }).returning())[0]!);
    for (const d of await svc(a).list()) await svc(a).remove(d.id, d.hostname);
    const d = await svc(a).add({ hostname: "www.takeover.in" });
    point(d);
    await svc(a).checkNow(d.id);
    expect((await row(d.id)).isPrimary).toBe(true);
    expect((await row(sub.id)).isPrimary).toBe(false);
    await svc(a).remove(d.id, d.hostname);
    expect((await row(sub.id)).isPrimary).toBe(true);
    await withConsole((tx) => tx.delete(schoolDomains).where(eq(schoolDomains.id, sub.id)));
  });
});

describe("adding, removing, redirect", () => {
  beforeAll(async () => { for (const d of await svc(a).list()) await svc(a).remove(d.id, d.hostname); });

  it("adds www.x and x in one step (D2), records an event for each, and leaves room for the limit", async () => {
    const d = await svc(a).add({ hostname: "WWW.Pair-School.in", pair: "on" });
    expect(d.hostname).toBe("www.pair-school.in");
    const all = await svc(a).list();
    expect(all.map((x) => x.hostname).sort()).toEqual(["pair-school.in", "www.pair-school.in"]);
    expect((await events(d.id)).map((e) => e.kind)).toEqual(["added"]);
    await expect(svc(a).add({ hostname: "x.pair-school.in", pair: "on" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc(a).add({ hostname: "www.two.in", pair: "on" })).rejects.toBeInstanceOf(LimitError);
    for (const x of all) await svc(a).remove(x.id);
  });

  it("a live domain is removed only when its name is typed", async () => {
    const d = await svc(a).add({ hostname: "www.typed.in" });
    point(d);
    await svc(a).checkNow(d.id);
    await expect(svc(a).remove(d.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc(a).remove(d.id, "www.other.in")).rejects.toBeInstanceOf(ValidationError);
    expect((await svc(a).remove(d.id, " WWW.typed.in "))).toMatchObject({ hostname: "www.typed.in" });
    expect((await events(d.id)).map((e) => e.kind).sort()).toEqual(["added", "checked", "removed", "verified"]);
  });

  it("the redirect switch is saved and audited with the old and new value", async () => {
    await svc(a).setRedirect(false);
    expect((await withConsole((tx) => tx.select().from(schools).where(eq(schools.id, a.id))))[0]!.redirectToPrimary).toBe(false);
    await svc(a).setRedirect(true);
    await expect(svc(a, "teacher").setRedirect(false)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a domain without a working certificate cannot be made main yet", async () => {
    const d = await svc(a).add({ hostname: "www.nocert.in" });
    point(d);
    tls.results[d.hostname] = { ok: false, issuer: null, expiresAt: null, error: "none" };
    await svc(a).checkNow(d.id);
    await expect(svc(a).setPrimary(d.id)).rejects.toThrow(/secure certificate/);
    await svc(a).remove(d.id, d.hostname);
  });

  it("a domain with a broken record cannot be made main", async () => {
    const d = await svc(a).add({ hostname: "www.shaky.in" });
    point(d);
    await svc(a).checkNow(d.id);
    await withConsole((tx) => tx.update(schoolDomains).set({ health: "broken" }).where(eq(schoolDomains.id, d.id)));
    await expect(svc(a).setPrimary(d.id)).rejects.toBeInstanceOf(ConflictError);
    await svc(a).remove(d.id, d.hostname);
  });

  it("a failed claim goes back to pending when the school presses Check now, with a fresh 72 hours", async () => {
    const d = await svc(a).add({ hostname: "www.retry.in" });
    const past = new Date(Date.now() + VERIFY_WINDOW_MS + 60_000);
    await job(past).claim(d);
    expect((await row(d.id)).status).toBe("failed");
    const again = await svc(a, "admin", past).checkNow(d.id);
    expect(again.status).toBe("pending");
    expect(again.failingSince).toBeInstanceOf(Date);
    await svc(a).remove(d.id);
  });
});

describe("what the school role may write (grants and triggers)", () => {
  it("cannot set status, health, records or the clocks on its own domain", async () => {
    const d = await svc(a).add({ hostname: "www.grants.in" });
    for (const patch of [{ status: "verified" as const }, { health: "ok" as const }, { records: [] }, { failingSince: new Date() }, { toldAt: new Date() }, { certExpiresAt: new Date() }, { verifyToken: "x" }]) {
      await expect(withSchool(a.id, (tx) => tx.update(schoolDomains).set(patch).where(eq(schoolDomains.id, d.id))), JSON.stringify(patch)).rejects.toThrow();
    }
    await svc(a).remove(d.id);
  });

  it("an insert cannot start with health, records or a verified status", async () => {
    const forced = await withSchool(a.id, async (tx) => (await tx.insert(schoolDomains).values({
      schoolId: a.id, hostname: "forced.school.in", verifyToken: "t", status: "verified", health: "ok", records: [{ key: "txt", ok: true, expected: "x", found: [] }], toldAt: new Date(), certExpiresAt: new Date(),
    }).returning())[0]!);
    expect(forced).toMatchObject({ status: "pending", health: null, records: [], toldAt: null, certExpiresAt: null });
    await svc(a).remove(forced.id);
  });

  it("may write added, primary, removed and checked events, never the platform's words, and cannot change history", async () => {
    const d = await svc(a).add({ hostname: "www.history.in" });
    const put = (kind: "added" | "primary" | "removed" | "checked" | "verified" | "failing" | "recovered" | "failed" | "released" | "lost") =>
      withSchool(a.id, (tx) => tx.insert(schoolDomainEvents).values({ schoolId: a.id, domainId: d.id, hostname: d.hostname, kind }));
    for (const k of ["added", "primary", "removed", "checked"] as const) await put(k);
    for (const k of ["verified", "failing", "recovered", "failed", "released", "lost"] as const) await expect(put(k), k).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.update(schoolDomainEvents).set({ detail: "x" }).where(eq(schoolDomainEvents.domainId, d.id)))).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.delete(schoolDomainEvents).where(eq(schoolDomainEvents.domainId, d.id)))).rejects.toThrow();
    await svc(a).remove(d.id);
  });

  it("isolation: school B cannot read school A's events", async () => {
    const d = await svc(a).add({ hostname: "www.secret.in" });
    await expect(svc(b).events(d.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await withSchool(b.id, (tx) => tx.select().from(schoolDomainEvents).where(eq(schoolDomainEvents.domainId, d.id)))).toHaveLength(0);
    await svc(a).remove(d.id);
  });
});
