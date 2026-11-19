import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  closeDb, invoices, modules, oneTimeTokens, planModules, plans, platformAuditLogs, platformStaff, schools, subscriptions, supportMessages, supportTickets, withConsole,
} from "@smw/db";
import { LoginError, SchoolAuth } from "@smw/auth";
import { ConflictError, ForbiddenError, ValidationError, type StaffCtx } from "@smw/feature-kit";
import { createTestSchool } from "@smw/feature-kit/testing";
import {
  ModuleAdminService, OverviewService, PlanAdminService, SchoolAdminService, StaffAdminService, SupportDeskService, SupportLoginService,
} from "./index";

// The shared dev machine is busy while other suites run; give each test room.
vi.setConfig({ testTimeout: 90_000 });
afterAll(closeDb);

const staff = (role: StaffCtx["role"] = "owner"): StaffCtx => ({ staffId: crypto.randomUUID(), role, name: `Test ${role}` });
const owner = staff("owner");
let n = 0;
const slug = () => `plat${Date.now().toString(36)}${n++}`;
const newSchool = (extra: Record<string, unknown> = {}) =>
  new SchoolAdminService(owner).create({ name: "Test School", slug: slug(), adminName: "Asha Rao", adminEmail: `a${n}@x.test`, ...extra });
const logged = (action: string, schoolId: string) =>
  withConsole((tx) => tx.select().from(platformAuditLogs).where(and(eq(platformAuditLogs.action, action), eq(platformAuditLogs.schoolId, schoolId))));

describe("SchoolAdminService lifecycle", () => {
  it("creates a school in trial with a subdomain, an invited admin and an audit entry", async () => {
    const r = await newSchool({ trialDays: 14 });
    const d = await new SchoolAdminService(owner).detail(r.schoolId);
    expect(d.school.status).toBe("trial");
    expect(d.studentCount).toBe(0);
    expect((await new SchoolAdminService(owner).domains(r.schoolId)).map((x) => [x.kind, x.status])).toEqual([["subdomain", "verified"]]);
    expect(r.inviteToken.length).toBeGreaterThan(20);
    expect(await logged("school.create", r.schoolId)).toHaveLength(1);
  });

  it("refuses a duplicate address and a reserved one", async () => {
    const r = await newSchool();
    const s = (await new SchoolAdminService(owner).detail(r.schoolId)).school.slug;
    await expect(new SchoolAdminService(owner).create({ name: "Other", slug: s, adminName: "B C", adminEmail: "b@x.test" })).rejects.toBeInstanceOf(ConflictError);
    await expect(newSchool({ slug: "console" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("suspends and reactivates, logs both, and will not repeat itself", async () => {
    const { schoolId } = await newSchool();
    const svc = new SchoolAdminService(owner);
    expect((await svc.suspend(schoolId, "Unpaid")).status).toBe("suspended");
    await expect(svc.suspend(schoolId)).rejects.toBeInstanceOf(ConflictError);
    expect((await svc.reactivate(schoolId)).status).toBe("trial");
    await expect(svc.reactivate(schoolId)).rejects.toBeInstanceOf(ConflictError);
    expect(await logged("school.suspend", schoolId)).toHaveLength(1);
    expect(await logged("school.reactivate", schoolId)).toHaveLength(1);
  });

  it("reactivates to active once the trial is over, and cancels a scheduled deletion", async () => {
    const { schoolId } = await newSchool();
    await withConsole((tx) => tx.update(schools).set({ trialEndsAt: new Date(Date.now() - 86_400_000) }).where(eq(schools.id, schoolId)));
    const svc = new SchoolAdminService(owner);
    await svc.scheduleDeletion(schoolId);
    await svc.suspend(schoolId);
    const back = await svc.reactivate(schoolId);
    expect(back.status).toBe("active");
    expect(back.deletionScheduledAt).toBeNull();
  });

  it("schedules deletion 30 days out, owner only", async () => {
    const { schoolId } = await newSchool();
    const s = await new SchoolAdminService(owner).scheduleDeletion(schoolId);
    const days = (s.deletionScheduledAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    await expect(new SchoolAdminService(staff("support")).scheduleDeletion(schoolId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("extends a trial from its end, or from today once lapsed, and reopens a read-only trial", async () => {
    const { schoolId } = await newSchool({ trialDays: 10 });
    const svc = new SchoolAdminService(owner);
    const before = (await svc.detail(schoolId)).school.trialEndsAt!;
    const after = (await svc.extendTrial(schoolId, 7)).trialEndsAt!;
    expect(Math.round((after.getTime() - before.getTime()) / 86_400_000)).toBe(7);
    await withConsole((tx) => tx.update(schools).set({ status: "read_only", trialEndsAt: new Date(Date.now() - 5 * 86_400_000) }).where(eq(schools.id, schoolId)));
    const reopened = await svc.extendTrial(schoolId, 3);
    expect(reopened.status).toBe("trial");
    expect(Math.round((reopened.trialEndsAt!.getTime() - Date.now()) / 86_400_000)).toBe(3);
    await expect(svc.extendTrial(schoolId, 0)).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists with search, status and plan filters", async () => {
    const r = await newSchool({ name: "Zebra Public School" });
    const svc = new SchoolAdminService(owner);
    const found = await svc.list({ q: "zebra public" });
    expect(found.rows.map((x) => x.id)).toContain(r.schoolId);
    expect(found.rows[0]).toMatchObject({ studentCount: 0, status: "trial" });
    expect((await svc.list({ q: "zebra public", filters: { status: "suspended" } })).total).toBe(0);
  });

  it("checks staff roles: sales cannot suspend, support cannot create", async () => {
    const { schoolId } = await newSchool();
    await expect(new SchoolAdminService(staff("sales")).suspend(schoolId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SchoolAdminService(staff("support")).create({ name: "X Y", slug: slug(), adminName: "A B", adminEmail: "a@b.test" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("plan versions", () => {
  it("an edit adds version 2; schools and subscriptions on version 1 keep their plan and price", async () => {
    const key = `plan${slug()}`;
    const modKey = `mod_${key}`;
    const [v1] = await withConsole(async (tx) => {
      await tx.insert(modules).values({ key: modKey, name: "Plan module", stage: "ga" });
      const rows = await tx.insert(plans).values({ key, name: "Growth", studentCap: 1000, priceAnnualPaise: 1_200_000, priceMonthlyPaise: 120_000 }).returning();
      await tx.insert(planModules).values({ planId: rows[0]!.id, moduleKey: modKey });
      return rows;
    });
    const { schoolId } = await newSchool({ planId: v1!.id });
    await withConsole((tx) => tx.insert(subscriptions).values({ schoolId, planId: v1!.id, interval: "annual", status: "active", pricePaise: 1_200_000 }));

    const svc = new PlanAdminService(owner);
    const v2 = await svc.edit(v1!.id, { name: "Growth", studentCap: 1200, priceAnnualPaise: 1_500_000, priceMonthlyPaise: 150_000, moduleKeys: [modKey], isPublic: "true" });
    expect(v2).toMatchObject({ key, version: 2, studentCap: 1200, priceAnnualPaise: 1_500_000 });

    const all = (await svc.list()).filter((p) => p.key === key);
    expect(all.map((p) => [p.version, p.isLatest, p.isPublic])).toEqual([[2, true, true], [1, false, false]]);
    expect(all.find((p) => p.version === 2)!.moduleKeys).toEqual([modKey]);
    expect(all.find((p) => p.version === 1)!.schools).toBe(1);

    const d = await new SchoolAdminService(owner).detail(schoolId);
    expect(d.school.planId).toBe(v1!.id);
    const [sub] = await withConsole((tx) => tx.select().from(subscriptions).where(eq(subscriptions.schoolId, schoolId)));
    expect(sub).toMatchObject({ planId: v1!.id, pricePaise: 1_200_000 });

    await expect(svc.edit(v1!.id, { name: "Growth", studentCap: 5, priceAnnualPaise: 1, priceMonthlyPaise: 1, moduleKeys: [] })).rejects.toBeInstanceOf(ConflictError);
    await expect(new PlanAdminService(staff("sales")).edit(v2.id, { name: "x y", studentCap: 5, priceAnnualPaise: 1, priceMonthlyPaise: 1, moduleKeys: [] })).rejects.toBeInstanceOf(ForbiddenError);

    // Moving a school to the new version updates its student cap.
    const moved = await new SchoolAdminService(owner).changePlan(schoolId, v2.id);
    expect(moved).toMatchObject({ planId: v2.id, studentCap: 1200 });
  });

  it("will not move a school to a switched-off plan", async () => {
    const [p] = await withConsole((tx) => tx.insert(plans).values({ key: `off${slug()}`, name: "Off", studentCap: 10, priceAnnualPaise: 1, priceMonthlyPaise: 1, isActive: false }).returning());
    const { schoolId } = await newSchool();
    await expect(new SchoolAdminService(owner).changePlan(schoolId, p!.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("module overrides", () => {
  it("forces a module on, honours expiry, and can be removed", async () => {
    const key = `ovr${slug()}`;
    await withConsole((tx) => tx.insert(modules).values({ key, name: "Override me", stage: "beta" }));
    const { schoolId } = await newSchool();
    const svc = new SchoolAdminService(owner);
    const state = async () => (await svc.moduleStates(schoolId)).find((m) => m.key === key)!;
    expect((await state()).enabled).toBe(false);

    await svc.setOverride(schoolId, { moduleKey: key, enabled: "true", note: "Pilot", expiresAt: "2099-01-01" });
    expect(await state()).toMatchObject({ enabled: true, override: { enabled: true, note: "Pilot" } });

    await svc.setOverride(schoolId, { moduleKey: key, enabled: "true", expiresAt: "2020-01-01" });
    expect((await state()).enabled).toBe(false); // expired overrides do nothing

    await svc.removeOverride(schoolId, key);
    expect((await state()).override).toBeNull();
    expect(await logged("school.override", schoolId)).toHaveLength(2);
  });

  it("counts schools with a module on and changes its stage (owner only)", async () => {
    const key = `cnt${slug()}`;
    await withConsole((tx) => tx.insert(modules).values({ key, name: "Counted", stage: "alpha" }));
    const { schoolId } = await newSchool();
    await new SchoolAdminService(owner).setOverride(schoolId, { moduleKey: key, enabled: "true" });
    const svc = new ModuleAdminService(owner);
    expect((await svc.list()).find((m) => m.key === key)).toMatchObject({ schoolsEnabled: 1, activeSchools30d: 0 });
    expect((await svc.setStage(key, "ga")).stage).toBe("ga");
    await expect(new ModuleAdminService(staff("support")).setStage(key, "beta")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("SupportLoginService", () => {
  const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;

  it("makes a single-use token that becomes a read-only support session", async () => {
    const school = await createTestSchool(`sl${slug()}`.slice(0, 20), []);
    const support = staff("support");
    const r = await new SupportLoginService(support).create({ schoolId: school.id, reason: "Fee receipt problem" });
    expect(r.url).toContain("/support-login?token=");
    expect(r.url).toContain(school.slug);

    const auth = new SchoolAuth(school.id);
    const { token } = await auth.supportLogin(tokenOf(r.url));
    const session = await auth.validate(token);
    expect(session).toMatchObject({ readOnly: true, supportStaffId: support.staffId });
    expect(session!.user.role).toBe("admin");
    await expect(auth.supportLogin(tokenOf(r.url))).rejects.toBeInstanceOf(LoginError); // single use
    expect((await logged("support.login", school.id))).toHaveLength(1);
  });

  it("expires after five minutes", async () => {
    const school = await createTestSchool(`ex${slug()}`.slice(0, 20), []);
    const r = await new SupportLoginService(owner).create({ schoolId: school.id, reason: "Checking setup" });
    const [row] = await withConsole((tx) => tx.select().from(oneTimeTokens).where(and(eq(oneTimeTokens.schoolId, school.id), eq(oneTimeTokens.purpose, "support_login"))));
    expect(Math.round((row!.expiresAt.getTime() - Date.now()) / 60_000)).toBe(5);
    expect(row!.meta).toMatchObject({ staffId: owner.staffId, reason: "Checking setup", allowWrites: false });
    await withConsole((tx) => tx.update(oneTimeTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(oneTimeTokens.id, row!.id)));
    await expect(new SchoolAuth(school.id).supportLogin(tokenOf(r.url))).rejects.toBeInstanceOf(LoginError);
  });

  it("allows changes only when an owner asks for them", async () => {
    const school = await createTestSchool(`wr${slug()}`.slice(0, 20), []);
    await expect(new SupportLoginService(staff("support")).create({ schoolId: school.id, reason: "Need to fix it", allowWrites: "true" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SupportLoginService(staff("sales")).create({ schoolId: school.id, reason: "Just looking" })).rejects.toBeInstanceOf(ForbiddenError);
    const r = await new SupportLoginService(owner).create({ schoolId: school.id, reason: "Fixing a wrong fee", allowWrites: "true" });
    const auth = new SchoolAuth(school.id);
    const { token } = await auth.supportLogin(tokenOf(r.url));
    expect((await auth.validate(token))!.readOnly).toBe(false);
  });

  it("needs a reason, and a token only works on its own school", async () => {
    const a = await createTestSchool(`ra${slug()}`.slice(0, 20), []);
    const b = await createTestSchool(`rb${slug()}`.slice(0, 20), []);
    await expect(new SupportLoginService(owner).create({ schoolId: a.id, reason: "hi" })).rejects.toBeInstanceOf(ValidationError);
    const r = await new SupportLoginService(owner).create({ schoolId: a.id, reason: "Cross-check" });
    await expect(new SchoolAuth(b.id).supportLogin(tokenOf(r.url))).rejects.toBeInstanceOf(LoginError);
  });
});

describe("SupportDeskService", () => {
  it("replies, moves the ticket to pending, takes it, and refuses a closed one", async () => {
    const school = await createTestSchool(`td${slug()}`.slice(0, 20), []);
    const [t] = await withConsole(async (tx) => {
      const rows = await tx.insert(supportTickets).values({ schoolId: school.id, subject: "Cannot print", createdByUserId: school.users.admin }).returning();
      await tx.insert(supportMessages).values({ schoolId: school.id, ticketId: rows[0]!.id, authorUserId: school.users.admin, body: "Help" });
      return rows;
    });
    const me = staff("support");
    const svc = new SupportDeskService(me);
    await svc.reply(t!.id, { body: "Looking into it" });
    const thread = await svc.thread(t!.id);
    expect(thread.t).toMatchObject({ status: "pending", assignedStaffId: me.staffId });
    expect(thread.messages.map((m) => !!m.fromStaff)).toEqual([false, true]);
    expect((await svc.list({ filters: { assigned: "me" } })).rows.map((r) => r.id)).toContain(t!.id);

    await svc.setStatus(t!.id, "closed");
    await expect(svc.reply(t!.id, { body: "more" })).rejects.toBeInstanceOf(ConflictError);
    await expect(new SupportDeskService(staff("sales")).list()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("StaffAdminService", () => {
  it("adds staff, resets two-step, and will not disable yourself", async () => {
    const svc = new StaffAdminService(owner);
    const email = `staff${slug()}@x.test`;
    const { id } = await svc.create({ name: "New Hire", email, role: "support", password: "a-long-password" });
    await expect(svc.create({ name: "Dup", email: email.toUpperCase(), role: "sales", password: "a-long-password" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.create({ name: "Weak", email: "w@x.test", role: "sales", password: "short" })).rejects.toBeInstanceOf(ValidationError);
    await withConsole((tx) => tx.update(platformStaff).set({ totpSecret: "ABCDEFGHIJKLMNOP", totpEnabled: true }).where(eq(platformStaff.id, id)));
    await svc.resetTwoFactor(id);
    const [row] = await withConsole((tx) => tx.select().from(platformStaff).where(eq(platformStaff.id, id)));
    expect(row).toMatchObject({ totpEnabled: false, totpSecret: null });
    const list = await svc.list();
    expect(JSON.stringify(list)).not.toContain("argon2id");
    await expect(svc.setStatus(owner.staffId, "disabled")).rejects.toBeInstanceOf(ConflictError);
    await svc.setStatus(id, "disabled");
    await expect(new StaffAdminService(staff("support")).list()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("OverviewService", () => {
  it("reports 0 MRR with no subscriptions, then counts an annual one as a twelfth", async () => {
    const svc = new OverviewService(owner);
    const before = await svc.summary();
    const { schoolId } = await newSchool();
    const [plan] = await withConsole((tx) => tx.insert(plans).values({ key: `mrr${slug()}`, name: "M", studentCap: 10, priceAnnualPaise: 1, priceMonthlyPaise: 1 }).returning());
    await withConsole((tx) => tx.insert(subscriptions).values({ schoolId, planId: plan!.id, interval: "annual", status: "active", pricePaise: 2_400_000 }));
    const after = await svc.summary();
    expect(after.mrrPaise - before.mrrPaise).toBe(200_000);
    expect(after.totalSchools).toBe(before.totalSchools + 1);
    expect(after.recentSignups[0]!.id).toBe(schoolId);
  });

  it("lists trials ending within a week and counts overdue invoices", async () => {
    const svc = new OverviewService(owner);
    const before = await svc.summary();
    const { schoolId } = await newSchool({ trialDays: 3 });
    const mid = await svc.summary();
    expect(mid.trialEnding7d).toBe(before.trialEnding7d + 1);
    expect(mid.trialsEnding.some((s) => s.id === schoolId)).toBe(true);
    await withConsole((tx) => tx.insert(invoices).values({ schoolId, number: `OV-${slug()}`, financialYear: "2026-27", status: "issued", description: "Late", taxablePaise: 1000, totalPaise: 1180, dueAt: new Date(Date.now() - 86_400_000) }));
    const after = await svc.summary();
    expect(after.overdueInvoices.count).toBe(before.overdueInvoices.count + 1);
    expect(after.overdueInvoices.paise - before.overdueInvoices.paise).toBe(1180);
  });
});
