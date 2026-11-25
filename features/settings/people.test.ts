// Proves the people side of Settings against a real database: add a login, sign-in events, bulk actions, the last admin, own role,
// partial profile updates, role removal warnings, the failed-sign-in watch, and school isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LoginError, SchoolAuth, loginLimiter, loginIpFailLimiter } from "@smw/auth";
import { auditLogs, closeDb, eq, modules, sql, users, uuidv7, withConsole, withSchool } from "@smw/db";
import { ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, useServices } from "@smw/integrations";
import { notifications } from "@smw/feature-notifications/schema";
import type { Catalogue } from "./catalogue";
import { completeness, profileWarnings } from "./profile-meta";
import { watchSignIns } from "./jobs-signin";
import { HubService, ModulesService, RoleService, SchoolProfileService, SignInService, UserAdminService, alertsNewDevice } from "./service";

const library = { key: "library", name: "Library", permissions: { read: ["admin", "teacher"], manage: ["admin", "teacher"] } } as const;
const fees = { key: "fees", name: "Fees", permissions: { read: ["admin", "accountant"], manage: ["admin", "accountant"] } } as const;
const home = { key: "home", name: "Home", permissions: { view: ["admin", "teacher", "student"] } } as const;
const CAT: Catalogue = [library, fees, home];

const mail = new MemoryEmailSender();
let a: TestSchool, b: TestSchool;
beforeAll(async () => {
  useServices({ email: mail });
  ({ a, b } = await createSchoolPair(["settings", "library", "fees", "notifications"], "ppl"));
});
afterAll(closeDb);

const svc = (s: TestSchool) => new UserAdminService(s.as.admin);
const tokenIn = (text: string) => /token=([\w-]+)/.exec(text)![1]!;
const support = (s: TestSchool): Ctx => ({ ...s.as.admin, supportStaffId: uuidv7() });

describe("S3: an admin adds a login (admin, accountant, any custom role)", () => {
  it("mails an invite that works, and the person starts as invited", async () => {
    mail.sent.length = 0;
    const r = await svc(a).createLogin({ name: "Meera Rao", email: "Meera@School-A.test", role: "accountant" });
    expect(r).toMatchObject({ emailed: true, accessLink: null, user: { name: "Meera Rao", status: "invited", role: "accountant", email: "meera@school-a.test", loginId: "meera@school-a.test" } });
    const sent = mail.sent.at(-1)!;
    expect(sent.to).toBe("meera@school-a.test");
    const auth = new SchoolAuth(a.id);
    await auth.resetPassword(tokenIn(sent.text), "Maple-River-42");
    expect((await auth.login("meera@school-a.test", "Maple-River-42")).token).toBeTruthy();
    expect((await svc(a).list({ filters: { q: "" } })).rows.find((u) => u.id === r.user.id)?.status).toBe("active");
  });

  it("a login with only a mobile number gets an access link, not a mail", async () => {
    mail.sent.length = 0;
    const r = await svc(a).createLogin({ name: "Front Desk", phone: "9876500011", role: "accountant" });
    expect(r.emailed).toBe(false);
    expect(r.accessLink).toMatch(/\/reset-password\?token=/);
    expect(mail.sent).toHaveLength(0);
    await new SchoolAuth(a.id).resetPassword(tokenIn(r.accessLink!), "Maple-River-43");
  });

  it("'send me a link' gives the link even when there is an email; a custom role works; a teacher role is sent to Staff", async () => {
    const role = await new RoleService(a.as.admin).create({ name: "Library desk", base: "staff", grants: ["library:read"] }, CAT);
    const r = await svc(a).createLogin({ name: "Lib Rian", email: "lib@school-a.test", role: role.key, send: "link" });
    expect(r.accessLink).toBeTruthy();
    expect(r.user).toMatchObject({ roleId: role.key, roleName: "Library desk", role: "staff" });
    const teacherRole = await new RoleService(a.as.admin).create({ name: "Class helper", base: "teacher", grants: ["library:read"] }, CAT);
    await expect(svc(a).createLogin({ name: "Some Teacher", email: "t@school-a.test", role: "teacher" })).rejects.toMatchObject({ fieldErrors: { role: expect.stringMatching(/Staff/) } });
    await expect(svc(a).createLogin({ name: "Some Teacher", email: "t2@school-a.test", role: teacherRole.key })).rejects.toMatchObject({ fieldErrors: { role: expect.any(String) } });
  });

  it("needs a way to reach them, refuses an email or mobile already in use, and a name", async () => {
    await expect(svc(a).createLogin({ name: "No Contact", role: "accountant" })).rejects.toMatchObject({ fieldErrors: { email: expect.any(String) } });
    await expect(svc(a).createLogin({ name: "Same Mail", email: "meera@school-a.test", role: "accountant" })).rejects.toMatchObject({ fieldErrors: { email: expect.stringMatching(/already/) } });
    await expect(svc(a).createLogin({ name: "Same Phone", phone: "9876500011", role: "accountant" })).rejects.toMatchObject({ fieldErrors: { phone: expect.stringMatching(/already/) } });
    await expect(svc(a).createLogin({ name: "X", email: "x@school-a.test", role: "accountant" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("only an admin makes an admin; teachers and students cannot add logins; a read-only school cannot", async () => {
    const accountantCtx: Ctx = { ...a.as.admin, role: "accountant", userId: a.users.accountant, grants: new Set(["settings:manage"]) };
    await expect(new UserAdminService(accountantCtx).createLogin({ name: "New Admin", email: "na@school-a.test", role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new UserAdminService(a.as.teacher).createLogin({ name: "Nope Nope", email: "n@school-a.test", role: "accountant" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new UserAdminService({ ...a.as.admin, readOnly: true }).createLogin({ name: "Nope Nope", email: "n@school-a.test", role: "accountant" })).rejects.toThrow(/read-only/);
    const admin2 = await svc(a).createLogin({ name: "Second Admin", email: "admin2@school-a.test", role: "admin" });
    expect(admin2.user.role).toBe("admin");
  });

  it("is written to the audit log, and a school's logins are its own", async () => {
    const rows = await withSchool(a.id, (tx) => tx.select({ s: auditLogs.summary }).from(auditLogs).where(eq(auditLogs.action, "create_login")));
    expect(rows.some((r) => r.s?.includes("Meera Rao"))).toBe(true);
    expect((await svc(b).list({ q: "Meera" })).rows).toHaveLength(0);
    await expect(svc(b).createLogin({ name: "Other School", email: "meera@school-a.test", role: "accountant" })).resolves.toBeTruthy(); // the same email in another school is fine
  });

  it("a support session cannot add, change, disable or sign anyone out", async () => {
    const s = new UserAdminService(support(a));
    await expect(s.createLogin({ name: "By Support", email: "bs@school-a.test", role: "accountant" })).rejects.toThrow(/Support sessions cannot manage users/);
    await expect(s.disable(a.users.teacher)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(s.signOutEverywhere(a.users.teacher)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(s.changeRole(a.users.teacher, { role: "accountant" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(s.accessLink(a.users.teacher)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(s.bulk({ ids: [a.users.teacher], action: "disable" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("users: bulk actions, filters, CSV, the last admin and your own role", () => {
  it("resends invites only to people who have not set a password, and names who could not be done", async () => {
    const one = await svc(a).createLogin({ name: "Still Waiting", email: "wait@school-a.test", role: "accountant" });
    mail.sent.length = 0;
    const r = await svc(a).bulk({ ids: [one.user.id, a.users.teacher], action: "resend" });
    expect(r.done).toBe(1);
    expect(r.skipped).toEqual([{ name: expect.any(String), why: expect.stringMatching(/already set a password/) }]);
    expect(mail.sent).toHaveLength(1);
  });

  it("disables many at once, signs out, but never the last admin or yourself", async () => {
    const x = await svc(a).createLogin({ name: "Bulk One", email: "b1@school-a.test", role: "accountant" });
    const r = await svc(a).bulk({ ids: [x.user.id, a.users.admin], action: "disable" });
    expect(r.done).toBe(1);
    expect(r.skipped[0]!.why).toMatch(/your own account/);
    const so = await svc(a).bulk({ ids: [a.users.admin], action: "signout" });
    expect(so.skipped[0]!.why).toMatch(/yourself/);
  });

  it("the last admin cannot be disabled or demoted, one by one or in bulk", async () => {
    // School B starts with one admin. A second one is added and activated; then the first steps aside.
    const second = await svc(b).createLogin({ name: "B Second", email: "b2@school-b.test", role: "admin" });
    await withSchool(b.id, (tx) => tx.update(users).set({ status: "active" }).where(eq(users.id, second.user.id)));
    await new UserAdminService({ ...b.as.admin, userId: second.user.id }).disable(b.users.admin); // two active admins: allowed
    // Now `second` is the only active admin.
    await expect(svc(b).disable(second.user.id)).rejects.toThrow(/last admin/);
    await expect(svc(b).changeRole(second.user.id, { role: "accountant" })).rejects.toThrow(/last admin/);
    const bulk = await svc(b).bulk({ ids: [second.user.id], action: "disable" });
    expect(bulk).toMatchObject({ done: 0, skipped: [{ name: "B Second", why: expect.stringMatching(/last admin/) }] });
    const [row] = await withSchool(b.id, (tx) => tx.select({ s: users.status }).from(users).where(eq(users.id, second.user.id)));
    expect(row!.s).toBe("active");
  });

  it("nobody changes their own role", async () => {
    await expect(svc(a).changeRole(a.users.admin, { role: "accountant" })).rejects.toThrow(/your own role/);
  });

  it("filters by never signed in, no email, unverified, custom role and ignores a made-up filter", async () => {
    const never = await svc(a).list({ filters: { show: "never" } });
    expect(never.rows.every((u) => u.lastLoginAt === null)).toBe(true);
    const custom = await svc(a).list({ filters: { show: "custom" } });
    expect(custom.rows.length).toBeGreaterThan(0);
    expect(custom.rows.every((u) => u.roleId)).toBe(true);
    const noEmail = await svc(a).list({ filters: { show: "noemail" } });
    expect(noEmail.rows.every((u) => !u.email)).toBe(true);
    const unverified = await svc(a).list({ filters: { show: "unverified" } });
    expect(unverified.rows.every((u) => u.email && !u.emailVerifiedAt)).toBe(true);
    expect((await svc(a).list({ filters: { show: "constructor" } })).total).toBe((await svc(a).list()).total);
  });

  it("the CSV has the people in the filter, no password material, and defuses formulas", async () => {
    await svc(a).createLogin({ name: "=HYPERLINK(\"x\")", email: "f@school-a.test", role: "accountant" });
    const csv = await svc(a).csv();
    expect(csv.split("\r\n")[0]).toContain("Name,Login ID,Email");
    expect(csv).toContain("Meera Rao");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv.toLowerCase()).not.toMatch(/argon2|password_hash|token/);
    expect(csv).not.toContain("Other School");
    await expect(new UserAdminService(a.as.teacher).csv()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("one person's page", () => {
  it("says what they can do in words, lists their devices, and ends one", async () => {
    const role = await new RoleService(a.as.admin).create({ name: "Desk reader", base: "staff", grants: ["fees:read", "library:read", "library:manage"] }, CAT);
    const made = await svc(a).createLogin({ name: "Detail Person", email: "detail@school-a.test", role: role.key });
    const auth = new SchoolAuth(a.id);
    await auth.resetPassword(tokenIn(mail.sent.at(-1)!.text), "Maple-River-44");
    await auth.login("detail@school-a.test", "Maple-River-44", { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537" });
    await auth.login("detail@school-a.test", "Maple-River-44", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/17 Safari/605" });
    const d = await svc(a).detail(made.user.id, CAT);
    expect(d.access.find((m) => m.key === "library")?.items).toEqual(expect.arrayContaining(["View", "Manage"]));
    expect(d.access.find((m) => m.key === "fees")?.items).toEqual(["View"]);
    expect(d.everything).toBe(false);
    expect(d.devices).toHaveLength(2);
    await svc(a).endSession(made.user.id, d.devices[0]!.id);
    expect((await svc(a).detail(made.user.id, CAT)).devices).toHaveLength(1);
    await expect(svc(a).endSession(made.user.id, d.devices[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    const admin = await svc(a).detail(a.users.admin, CAT);
    expect(admin.everything).toBe(true);
  });

  it("is not readable by another school or another role", async () => {
    await expect(svc(b).detail(a.users.teacher, CAT)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new UserAdminService(a.as.teacher).detail(a.users.teacher, CAT)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(b).endSession(a.users.teacher, uuidv7())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("S4: sign-in activity", () => {
  it("shows a failed try, with who it was and the device, and lets the person see their own", async () => {
    loginLimiter.reset(`acct:${a.id}:ghost@school-a.test`);
    await new SchoolAuth(a.id).login("ghost@school-a.test", "x-wrong-pass", { ip: "7.7.7.7", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537" }).catch(() => undefined);
    await new SchoolAuth(a.id).login(`teacher-${a.slug}`, "wrong-pass-1", { ip: "7.7.7.8" }).catch(() => undefined);
    const failed = await new SignInService(a.as.admin).list({ filters: { outcome: "failed" } });
    expect(failed.rows.map((r) => r.outcome)).toEqual(expect.arrayContaining(["unknown_login", "bad_password"]));
    const ghost = failed.rows.find((r) => r.identifier === "ghost@school-a.test")!;
    expect(ghost).toMatchObject({ userId: null, name: null, ip: "7.7.7.7", device: "Chrome on Windows" });
    const mine = await new SignInService(a.as.teacher).history(a.users.teacher);
    expect(mine.some((r) => r.outcome === "bad_password")).toBe(true);
    await expect(new SignInService(a.as.teacher).history(a.users.admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SignInService(a.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("filters by person, way in, new device and day; the CSV follows the filter", async () => {
    const auth = new SchoolAuth(a.id);
    await auth.login(`teacher-${a.slug}`, "password123", { ip: "5.5.5.5", userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile" });
    const s = new SignInService(a.as.admin);
    const newOnes = await s.list({ filters: { device: "new", user: a.users.teacher } });
    expect(newOnes.rows.length).toBeGreaterThan(0);
    expect(newOnes.rows.every((r) => r.newDevice && r.userId === a.users.teacher)).toBe(true);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    expect((await s.list({ filters: { from: today, to: today, method: "password" } })).total).toBeGreaterThan(0);
    expect((await s.list({ filters: { to: "2000-01-01" } })).total).toBe(0);
    const csv = await s.csv({ filters: { outcome: "failed" } });
    expect(csv).toContain("When (IST),Typed login,Person,Result");
    expect(csv).toContain("ghost@school-a.test");
    expect(csv).not.toContain("5.5.5.5");
    expect(csv.toLowerCase()).not.toContain("wrong-pass");
    expect((await s.summary()).failed).toBeGreaterThan(0);
  });

  it("isolation: school B sees none of school A's tries", async () => {
    const rows = await new SignInService(b.as.admin).list({ q: "ghost" });
    expect(rows.total).toBe(0);
    expect((await new SignInService(b.as.admin).csv()).includes("ghost@school-a.test")).toBe(false);
  });

  it("every path writes a row and the answers for a known and an unknown login are the same", async () => {
    const wrong = async (id: string) => (await new SchoolAuth(a.id).login(id, "definitely-wrong").catch((e) => e)) as LoginError;
    const known = await wrong(`teacher-${a.slug}`);
    const unknown = await wrong("nobody-here@school-a.test");
    expect(known).toBeInstanceOf(LoginError);
    expect({ reason: unknown.reason, message: unknown.message }).toEqual({ reason: known.reason, message: known.message });
  });
});

describe("failed sign-in watch", () => {
  const fail = async (s: TestSchool, id: string, n: number) => {
    for (let i = 0; i < n; i++) await new SchoolAuth(s.id).login(id, "wrong-pass-9", { ip: `9.9.${i}.1` }).catch(() => undefined);
  };
  const told = (s: TestSchool) => withSchool(s.id, (tx) => tx.select().from(notifications).where(eq(notifications.topic, "account.security")));

  it("tells the admins once an hour when one login fails 10 times, and not for 9", async () => {
    loginIpFailLimiter.reset("ip:?");
    // Earlier tests in this file already failed sign-ins for the same logins; start this one from a clean hour.
    await withConsole((tx) => tx.execute(sql`delete from login_events`));
    loginLimiter.reset(`acct:${a.id}:teacher-${a.slug}`);
    await fail(a, `teacher-${a.slug}`, 9);
    const first = await watchSignIns();
    expect(first.told).toBe(0);
    // Only a login that exists counts: anyone can type any name, so ten wrong tries on a name nobody has is noise, not a warning.
    await fail(a, "ghost-one@school-a.test", 12);
    await new SchoolAuth(a.id).supportLogin("not-a-token").catch(() => undefined);
    expect((await watchSignIns()).told).toBe(0);
    loginLimiter.reset(`acct:${a.id}:accountant-${a.slug}`);
    await fail(a, `accountant-${a.slug}`, 10);
    const run = await watchSignIns();
    expect(run.told).toBeGreaterThanOrEqual(1);
    const rows = await told(a);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.userId === a.users.admin || r.userId !== a.users.teacher)).toBe(true);
    expect(rows[0]!.title).toMatch(/10 failed sign-ins/);
    expect(rows[0]!.href).toContain("/app/settings/sign-ins?outcome=failed");
    expect((await watchSignIns()).told).toBe(0); // same hour: nothing new
    expect((await told(a)).length).toBe(rows.length);
  });

  it("is per school: school B hears nothing about school A", async () => {
    expect(await told(b)).toHaveLength(0);
  });
});

describe("school profile: new fields, partial updates, warnings", () => {
  const base = { name: "Green Valley Public School", timezone: "Asia/Kolkata", academicYearStartMonth: 4 };
  it("saves the new details, and a caller that leaves them out does not wipe them", async () => {
    const p = new SchoolProfileService(a.as.admin);
    const saved = await p.update({ ...base, affiliationNo: "2730123", schoolCode: "55012", schoolType: "Co-educational", medium: "English", establishedYear: "1998", district: "Pune", pincode: "411001", website: "www.gv.in", headName: "Dr. Asha Rao", headQualification: "M.Ed" });
    expect(saved).toMatchObject({ affiliationNo: "2730123", establishedYear: 1998, district: "Pune", pincode: "411001", headName: "Dr. Asha Rao" });
    const wizard = await p.update({ ...base, name: "Green Valley School", board: "CBSE", city: "Pune" }); // the setup wizard sends none of the new fields
    expect(wizard).toMatchObject({ name: "Green Valley School", affiliationNo: "2730123", establishedYear: 1998, pincode: "411001", headName: "Dr. Asha Rao", website: "www.gv.in" });
    const cleared = await p.update({ ...base, medium: "", website: "" });
    expect(cleared).toMatchObject({ medium: null, website: null, district: "Pune" });
  });

  it("checks the PIN code, the year and the web address", async () => {
    const err = await new SchoolProfileService(a.as.admin).update({ ...base, pincode: "12345", establishedYear: "1700", website: "not a site" }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(Object.keys(err.fieldErrors)).toEqual(expect.arrayContaining(["pincode", "establishedYear", "website"]));
    await expect(new SchoolProfileService(a.as.admin).update({ ...base, pincode: "011001" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("records what changed, field by field, in the audit log", async () => {
    await new SchoolProfileService(a.as.admin).update({ ...base, district: "Nashik" });
    const [row] = await withSchool(a.id, (tx) => tx.select({ m: auditLogs.meta }).from(auditLogs).where(eq(auditLogs.entity, "School")).orderBy(auditLogs.createdAt)).then((r) => r.slice(-1));
    expect((row!.m as { changes: Record<string, unknown> }).changes.district).toEqual(["Pune", "Nashik"]);
  });

  it("warns, without blocking, when the GSTIN state is not the school's state; counts what is missing", () => {
    expect(profileWarnings({ gstin: "27ABCDE1234F1Z5", state: "Maharashtra" })).toEqual([]);
    expect(profileWarnings({ gstin: "27ABCDE1234F1Z5", state: "Karnataka" })[0]!.text).toMatch(/registered in Maharashtra/);
    expect(profileWarnings({ gstin: "99ABCDE1234F1Z5", state: "Goa" })[0]!.text).toMatch(/not a state code/);
    expect(profileWarnings({ gstin: null, state: null })).toEqual([]);
    const c = completeness({ name: "X School", city: "Pune" });
    expect(c.filled).toBe(2);
    expect(c.missing.map((m) => m.key)).toContain("pincode");
  });

  it("isolation: another school's profile is untouched", async () => {
    const mine = await new SchoolProfileService(b.as.admin).get();
    expect(mine.district).toBeNull();
    expect(mine.pincode).toBeNull();
  });
});

describe("roles: page, history and the warning before a permission goes", () => {
  it("lists people and the history with what was added and removed", async () => {
    const roles = new RoleService(a.as.admin);
    const r = await roles.create({ name: "History role", base: "staff", grants: ["library:read"] }, CAT);
    await roles.update(r.key, { name: "History role", base: "staff", grants: ["library:read", "library:manage"] }, CAT);
    const made = await svc(a).createLogin({ name: "Hist Person", email: "hist@school-a.test", role: r.key });
    const d = await roles.detail(r.key, CAT);
    expect(d.people.map((p) => p.id)).toContain(made.user.id);
    expect(d.history[0]!.meta).toMatchObject({ added: ["library:manage"], removed: [] });
    const sys = await roles.detail("accountant", CAT);
    expect(sys.role.kind).toBe("system");
    expect(sys.history).toEqual([]);
    await expect(roles.detail(uuidv7(), CAT)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new RoleService(b.as.admin).detail(r.key, CAT)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stops before removing a permission its people used in the last 30 days, says who, and goes ahead when told to", async () => {
    const roles = new RoleService(a.as.admin);
    const r = await roles.create({ name: "Cashier two", base: "staff", grants: ["fees:read", "fees:manage"] }, CAT);
    const made = await svc(a).createLogin({ name: "Busy Cashier", email: "busy@school-a.test", role: r.key });
    await withSchool(a.id, (tx) => tx.insert(auditLogs).values({ schoolId: a.id, actorUserId: made.user.id, module: "fees", action: "collect", summary: "Took a payment" }));
    const keep = { name: "Cashier two", base: "staff", grants: ["fees:read"] };
    const err = await roles.update(r.key, keep, CAT).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fieldErrors.confirmRemoval).toMatch(/Busy Cashier made 1 changes in Fees in the last 30 days/);
    expect(err.fieldErrors.confirmRemoval).toMatch(/audit log/);
    expect((await roles.list(CAT)).find((x) => x.key === r.key)!.grants).toContain("fees:manage");
    const done = await roles.update(r.key, { ...keep, confirmRemoval: "true" }, CAT);
    expect(done.grants).not.toContain("fees:manage");
  });

  it("does not warn when the permission was never used, or when only viewing goes", async () => {
    const roles = new RoleService(a.as.admin);
    const r = await roles.create({ name: "Quiet role", base: "staff", grants: ["library:read", "library:manage"] }, CAT);
    const made = await svc(a).createLogin({ name: "Quiet Person", email: "quiet@school-a.test", role: r.key });
    await withSchool(a.id, (tx) => tx.insert(auditLogs).values({ schoolId: a.id, actorUserId: made.user.id, module: "library", action: "issue", summary: "Issued a book" }));
    await expect(roles.update(r.key, { name: "Quiet role", base: "staff", grants: ["library:manage"] }, CAT)).resolves.toBeTruthy(); // only "read" removed
    const old = await roles.create({ name: "Old use", base: "staff", grants: ["fees:manage"] }, CAT);
    const p2 = await svc(a).createLogin({ name: "Old User", email: "old@school-a.test", role: old.key });
    await withSchool(a.id, (tx) => tx.insert(auditLogs).values({ schoolId: a.id, actorUserId: p2.user.id, module: "fees", action: "collect", summary: "Old", createdAt: new Date(Date.now() - 40 * 86_400_000) }));
    await expect(roles.update(old.key, { name: "Old use", base: "staff", grants: [] }, CAT)).resolves.toBeTruthy(); // used 40 days ago: not recent
  });
});

describe("settings hub and modules", () => {
  it("the hub names what needs a look, each with a link", async () => {
    const items = await new HubService(a.as.admin).attention();
    expect(items.every((i) => i.href.startsWith("/app/"))).toBe(true);
    expect(items.map((i) => i.key)).toContain("invited");
    expect(items.map((i) => i.key)).toContain("profile");
    await expect(new HubService(a.as.teacher).attention()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("modules say in use, never used, or not in the plan", async () => {
    await withConsole((tx) => tx.insert(modules).values([
      { key: "ppl-used", name: "Used one", stage: "ga", core: false }, { key: "ppl-unused", name: "Unused one", stage: "ga", core: false }, { key: "ppl-off", name: "Off one", stage: "ga", core: false },
    ]).onConflictDoNothing());
    await withSchool(a.id, (tx) => tx.insert(auditLogs).values({ schoolId: a.id, actorUserId: a.users.admin, module: "ppl-used", action: "x", summary: "x" }));
    const rows = await new ModulesService({ ...a.as.admin, features: new Set([...a.as.admin.features, "ppl-used", "ppl-unused"]) }).list();
    const state = (k: string) => rows.find((r) => r.key === k)?.state;
    expect([state("ppl-used"), state("ppl-unused"), state("ppl-off")]).toEqual(["used", "unused", "off"]);
    expect(rows.find((r) => r.key === "ppl-used")!.lastUsed).toBeInstanceOf(Date);
    await expect(new ModulesService(a.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("new-device email choice", () => {
  it("is on for admins and accountants, off for others, and each person may change their own", () => {
    expect(alertsNewDevice({ role: "admin", alertNewDevice: null })).toBe(true);
    expect(alertsNewDevice({ role: "teacher", alertNewDevice: null })).toBe(false);
    expect(alertsNewDevice({ role: "teacher", alertNewDevice: true })).toBe(true);
    expect(alertsNewDevice({ role: "admin", alertNewDevice: false })).toBe(false);
  });
});
