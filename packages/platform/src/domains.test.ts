import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, platformAuditLogs, schoolDomainEvents, schoolDomains, withConsole } from "@smw/db";
import { ForbiddenError, NotFoundError, ValidationError, type StaffCtx } from "@smw/feature-kit";
import { createTestSchool } from "@smw/feature-kit/testing";
import { DomainAdminService } from "./domains";
import { ConflictError } from "@smw/feature-kit";

vi.setConfig({ testTimeout: 90_000 });
afterAll(closeDb);

const staff = (role: StaffCtx["role"]): StaffCtx => ({ staffId: crypto.randomUUID(), role, name: `Test ${role}` });
const svc = (role: StaffCtx["role"] = "owner") => new DomainAdminService(staff(role));
const tag = Date.now().toString(36);
const insert = (schoolId: string, hostname: string, extra: Partial<typeof schoolDomains.$inferInsert> = {}) =>
  withConsole(async (tx) => (await tx.insert(schoolDomains).values({ schoolId, hostname, kind: "custom", status: "verified", verifyToken: "t", ...extra }).returning())[0]!);
const audits = (schoolId: string, action: string) => withConsole((tx) => tx.select().from(platformAuditLogs).where(and(eq(platformAuditLogs.schoolId, schoolId), eq(platformAuditLogs.action, action))));

describe("DomainAdminService", () => {
  it("lists every school's domains with health and filters by it", async () => {
    const s = await createTestSchool(`dom1${tag}`, []);
    const t = await createTestSchool(`dom2${tag}`, []);
    await insert(s.id, `www.${tag}-one.in`, { health: "broken" });
    await insert(t.id, `www.${tag}-two.in`, { health: "ok" });
    const broken = await svc().list({ filters: { health: "broken" }, q: tag });
    expect(broken.rows.map((r) => r.hostname)).toEqual([`www.${tag}-one.in`]);
    expect(broken.rows[0]).toMatchObject({ health: "broken", schoolId: s.id });
    expect((await svc().list({ q: tag })).total).toBe(2);
    await expect(svc().list({ filters: { health: "bad" } })).rejects.toBeInstanceOf(ValidationError);
  });

  it("sales may look, never act", async () => {
    const s = await createTestSchool(`dom3${tag}`, []);
    const d = await insert(s.id, `www.${tag}-three.in`);
    expect((await svc("sales").get(d.id)).hostname).toBe(d.hostname);
    const run = vi.fn();
    await expect(svc("sales").checkNow(d.id, run)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc("sales").release(d.id, "Because of a reason", run)).rejects.toBeInstanceOf(ForbiddenError);
    expect(run).not.toHaveBeenCalled();
  });

  it("check now runs the check on that domain and audits it against the school", async () => {
    const s = await createTestSchool(`dom4${tag}`, []);
    const d = await insert(s.id, `www.${tag}-four.in`);
    const run = vi.fn(async () => ({ status: "verified", health: "ok" }));
    expect(await svc("support").checkNow(d.id, run)).toEqual({ status: "verified", health: "ok" });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: d.id, schoolId: s.id }), "Test support");
    expect((await audits(s.id, "domain.check"))[0]!.summary).toContain(`${d.hostname}: verified, ok`);
  });

  it("release needs a reason, runs the release and audits who and why", async () => {
    const s = await createTestSchool(`dom5${tag}`, []);
    const d = await insert(s.id, `www.${tag}-five.in`);
    const run = vi.fn(async () => ({ status: "failed", health: null }));
    await expect(svc().release(d.id, "  ", run)).rejects.toBeInstanceOf(ValidationError);
    expect(run).not.toHaveBeenCalled();
    await svc().release(d.id, "Owner of the domain asked us", run);
    expect(run).toHaveBeenCalledOnce();
    const [a] = await audits(s.id, "domain.release");
    expect(a!.summary).toContain("Owner of the domain asked us");
    expect(a!.meta).toMatchObject({ domainId: d.id, reason: "Owner of the domain asked us" });
  });

  it("5: allow lifts a staff release and only a staff release", async () => {
    const s = await createTestSchool(`dom6${tag}`, []);
    const d = await insert(s.id, `www.${tag}-six.in`, { status: "failed" });
    await expect(svc().allow(d.id)).rejects.toBeInstanceOf(ConflictError);
    await withConsole((tx) => tx.insert(schoolDomainEvents).values({ schoolId: s.id, domainId: d.id, hostname: d.hostname, kind: "released", detail: "Owner asked", byName: "Support Sam" }));
    expect((await svc().get(d.id)).staffReleased).toBe(true);
    await expect(svc("sales").allow(d.id)).rejects.toBeInstanceOf(ForbiddenError);
    await svc("support").allow(d.id);
    expect((await svc().get(d.id)).staffReleased).toBe(false);
    expect((await audits(s.id, "domain.allow"))).toHaveLength(1);
  });

  it("an unknown domain is not found", async () => {
    await expect(svc().get(crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc().release(crypto.randomUUID(), "A fine reason", async () => ({ status: "x", health: null }))).rejects.toBeInstanceOf(NotFoundError);
  });
});
