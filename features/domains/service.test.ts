import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { env } from "@smw/config";
import { closeDb, plans, schoolDomains, schools, withConsole } from "@smw/db";
import { ConflictError, ForbiddenError, LimitError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { FakeDnsResolver } from "@smw/integrations";
import { DomainService, DomainVerificationJob, VERIFY_WINDOW_MS, nextDomainState } from "./service";

let a: TestSchool, b: TestSchool;
const dns = new FakeDnsResolver();
const sites = () => `sites.${env().ROOT_DOMAIN}`;
const job = (now = new Date()) => new DomainVerificationJob(dns, env().ROOT_DOMAIN, () => now);
const svc = (s: TestSchool, role: "admin" | "teacher" = "admin", now?: Date) => new DomainService(s.as[role], job(now));
const row = async (id: string) => (await withConsole((tx) => tx.select().from(schoolDomains).where(eq(schoolDomains.id, id))))[0]!;
const point = (d: { hostname: string; verifyToken: string }) => {
  dns.records.txt[`_smw-verify.${d.hostname}`] = [`smw-verify=${d.verifyToken}`];
  dns.records.cname[d.hostname] = [sites()];
};

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
  const fail = { txtOk: false, cnameOk: false, ok: false, error: "nope" };
  it("verified on success", () => expect(nextDomainState({ createdAt: created }, { txtOk: true, cnameOk: true, ok: true }, new Date(created.getTime() + 1000)).status).toBe("verified"));
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
    expect(i.records[0]).toEqual({ type: "TXT", name: "_smw-verify.www.alpha-school.in", value: `smw-verify=${d.verifyToken}` });
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
    for (const d of await svc(a).list()) await svc(a).remove(d.id);
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
    await svc(a).remove(pending.id);
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
  beforeAll(async () => { for (const d of await svc(a).list()) await svc(a).remove(d.id); });
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
  beforeAll(async () => { for (const d of await svc(a).list()) await svc(a).remove(d.id); });
  it("a custom domain takes the main role from the free address, and gives it back when removed", async () => {
    const sub = await withConsole(async (tx) => (await tx.insert(schoolDomains).values({ schoolId: a.id, hostname: `a-${a.id.slice(0, 8)}.${env().ROOT_DOMAIN}`, kind: "subdomain", status: "verified", isPrimary: true, verifyToken: "x" }).returning())[0]!);
    for (const d of await svc(a).list()) await svc(a).remove(d.id);
    const d = await svc(a).add({ hostname: "www.takeover.in" });
    point(d);
    await svc(a).checkNow(d.id);
    expect((await row(d.id)).isPrimary).toBe(true);
    expect((await row(sub.id)).isPrimary).toBe(false);
    await svc(a).remove(d.id);
    expect((await row(sub.id)).isPrimary).toBe(true);
    await withConsole((tx) => tx.delete(schoolDomains).where(eq(schoolDomains.id, sub.id)));
  });
});
