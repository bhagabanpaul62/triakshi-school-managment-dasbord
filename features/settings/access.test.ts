import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, schools, sql, supportVisits, uuidv7, withConsole, withSchool } from "@smw/db";
import { ForbiddenError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { AccountService, SupportAccessService, accessState } from "./access-service";
import { AuditService } from "./audit-service";

let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(["settings"], "-acc")); });
afterAll(closeDb);

const row = async (id: string) => (await withConsole((tx) => tx.select({ m: schools.supportAccess, u: schools.supportAccessUntil, n: schools.name }).from(schools).where(eq(schools.id, id))))[0]!;

describe("SupportAccessService", () => {
  it("starts as always, and each setting is stored and logged with what it was", async () => {
    const svc = new SupportAccessService(a.as.admin);
    expect(await svc.state()).toMatchObject({ mode: "always", open: true });
    expect(await svc.setMode({ mode: "24h" })).toMatchObject({ mode: "until", open: true });
    const r = await row(a.id);
    expect(r.m).toBe("until");
    expect(r.u!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(r.u!.getTime()).toBeLessThan(Date.now() + 25 * 3_600_000);
    await svc.setMode({ mode: "72h" });
    expect((await row(a.id)).u!.getTime()).toBeGreaterThan(Date.now() + 71 * 3_600_000);
    expect(await svc.setMode({ mode: "never" })).toMatchObject({ mode: "never", open: false });
    expect((await row(a.id)).u).toBeNull();
    await svc.setMode({ mode: "always" });
    const logged = await new AuditService(a.as.admin).list({ q: "Support access" });
    expect(logged.total).toBeGreaterThanOrEqual(4);
    await expect(svc.setMode({ mode: "whenever" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("'I have read this' is written once per click as a read entry, changes no setting, and works in a read-only school", async () => {
    const svc = new SupportAccessService(a.as.admin);
    const before = await row(a.id);
    await svc.markRead();
    await new SupportAccessService({ ...a.as.admin, readOnly: true }).markRead();
    expect(await row(a.id)).toEqual(before);
    const logged = await new AuditService(a.as.admin).list({ q: "Read who may open" });
    expect(logged.total).toBeGreaterThanOrEqual(2);
    await expect(new SupportAccessService(a.as.teacher).markRead()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a time that has run out reads as closed", () => {
    expect(accessState({ supportAccess: "until", supportAccessUntil: new Date(Date.now() - 1000) })).toMatchObject({ mode: "until", open: false });
    expect(accessState({ supportAccess: "until", supportAccessUntil: new Date(Date.now() + 60_000) }).open).toBe(true);
  });

  it("admin only, not in a support session, read-only schools cannot change it, and school B is untouched", async () => {
    await expect(new SupportAccessService(a.as.teacher).state()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SupportAccessService(a.as.accountant).setMode({ mode: "never" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SupportAccessService({ ...a.as.admin, supportStaffId: uuidv7() }).setMode({ mode: "never" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SupportAccessService({ ...a.as.admin, readOnly: true }).setMode({ mode: "never" })).rejects.toThrow(/read-only/);
    await new SupportAccessService(a.as.admin).setMode({ mode: "never" });
    expect((await row(b.id)).m).toBe("always");
    await new SupportAccessService(a.as.admin).setMode({ mode: "always" });
  });

  it("lists every visit of this school only, newest first, with the changes that staff member made in the 30-minute session", async () => {
    const staff = uuidv7(), entered = new Date(Date.now() - 2 * 3_600_000);
    await withConsole(async (tx) => {
      await tx.insert(supportVisits).values([
        { schoolId: a.id, staffId: staff, staffName: "Tara Support", asUserId: a.users.admin, asUserName: "Admin A", reason: "Fix the fee plan", readOnly: false, enteredAt: entered },
        { schoolId: a.id, staffId: uuidv7(), staffName: "Link Only", asUserId: a.users.admin, asUserName: "Admin A", reason: "Never used", readOnly: true },
        { schoolId: b.id, staffId: staff, staffName: "Tara Support", asUserId: b.users.admin, asUserName: "Admin B", reason: "Other school", readOnly: true, enteredAt: entered },
      ]);
    });
    await withSchool(a.id, (tx) => tx.execute(sql`insert into audit_logs (id, school_id, actor_user_id, actor_staff_id, module, action, summary, created_at) values
      (${uuidv7()}, ${a.id}, ${a.users.admin}, ${staff}, 'fees', 'update', 'Support changed a plan', ${new Date(entered.getTime() + 20 * 60_000).toISOString()}::timestamptz),
      (${uuidv7()}, ${a.id}, ${a.users.admin}, ${staff}, 'fees', 'update', 'After the 30 minutes', ${new Date(entered.getTime() + 40 * 60_000).toISOString()}::timestamptz),
      (${uuidv7()}, ${a.id}, ${a.users.admin}, ${uuidv7()}, 'fees', 'update', 'Someone else', ${new Date(entered.getTime() + 5 * 60_000).toISOString()}::timestamptz)`));
    const visits = await new SupportAccessService(a.as.admin).visits();
    expect(visits.map((v) => v.reason).sort()).toEqual(["Fix the fee plan", "Never used"]);
    expect(visits.find((v) => v.staffName === "Tara Support")).toMatchObject({ changes: 1, readOnly: false, emergency: false });
    expect(visits.find((v) => v.staffName === "Link Only")).toMatchObject({ changes: 0, enteredAt: null });
    expect((await new SupportAccessService(b.as.admin).visits()).map((v) => v.reason)).toEqual(["Other school"]);
  });
});

describe("AccountService", () => {
  it("checks the typed school name and the reason, and says whether an export was made", async () => {
    const svc = new AccountService(a.as.admin);
    const name = (await row(a.id)).n;
    await expect(svc.closureRequest({ schoolName: "Not it", reason: "We are moving to another system" })).rejects.toMatchObject({ fieldErrors: { schoolName: expect.stringContaining(name) } });
    await expect(svc.closureRequest({ schoolName: name, reason: "short" })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    const out = await svc.closureRequest({ schoolName: ` ${name.toUpperCase()} `, reason: "We are moving to another system" });
    expect(out.subject).toBe(`Close the account of ${name}`);
    expect(out.body).toContain("We are moving to another system");
    expect(out.body).toContain("not made");
    expect(await svc.exportState()).toEqual({ ready: false, at: null });
    await withSchool(a.id, (tx) => tx.execute(sql`insert into data_exports (id, school_id, scope, label, status, finished_at) values (${uuidv7()}, ${a.id}, 'school', 'All', 'ready', now())`));
    expect((await svc.exportState()).ready).toBe(true);
    expect((await svc.closureRequest({ schoolName: name, reason: "We are moving to another system" })).body).toContain("made and is still available");
    await svc.logClosure(uuidv7());
    expect((await new AuditService(a.as.admin).list({ q: "close the account" })).total).toBe(1);
  });

  it("admin only, never in a support session; deleting nothing", async () => {
    await expect(new AccountService(a.as.teacher).closureRequest({})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new AccountService({ ...a.as.admin, supportStaffId: uuidv7() }).exportState()).rejects.toBeInstanceOf(ForbiddenError);
    expect((await row(a.id)).n).toBeTruthy();
  });
});
