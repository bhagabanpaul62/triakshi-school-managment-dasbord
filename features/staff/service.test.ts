import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SchoolAuth, LoginError } from "@smw/auth";
import { closeDb, eq, sessions, users, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections, sectionTeachers, subjects } from "@smw/feature-academics/schema";
import { MemoryEmailSender, useServices } from "@smw/integrations";
import { StaffService } from "./service";

let a: TestSchool, b: TestSchool;
const mail = new MemoryEmailSender();
let n = 0;
const person = (over: Record<string, unknown> = {}) => {
  n++;
  return { name: `Teacher ${n}`, role: "teacher", employeeId: `E${n}`, email: `t${n}@a.test`, designation: "TGT", department: "Science", ...over };
};
const tokenIn = (m: { text: string }) => /token=([\w-]+)/.exec(m.text)![1]!;

beforeAll(async () => {
  useServices({ email: mail });
  ({ a, b } = await createSchoolPair(["academics", "staff"]));
});
afterAll(closeDb);

describe("StaffService", () => {
  it("creates an invited login plus profile and mails a set-password link that works once", async () => {
    const svc = new StaffService(a.as.admin);
    const before = mail.sent.length;
    const s = await svc.create(person({ name: "Priya Sharma", email: "priya@a.test", employeeId: "T100" }));
    expect(s).toMatchObject({ state: "invited", role: "teacher", employeeId: "T100", emailed: true });

    const [u] = await withSchool(a.id, (tx) => tx.select().from(users).where(eq(users.id, s.id)));
    expect(u).toMatchObject({ status: "invited", passwordHash: null, loginId: "priya@a.test" });

    const m = mail.sent[before]!;
    expect(m.to).toBe("priya@a.test");
    expect(m.text).toContain("/reset-password?token=");

    const auth = new SchoolAuth(a.id);
    await auth.resetPassword(tokenIn(m), "brand-new-pass");
    expect((await svc.get(s.id)).state).toBe("active");
    expect((await auth.login("priya@a.test", "brand-new-pass")).token).toBeTruthy();
    await expect(auth.resetPassword(tokenIn(m), "another-pass-1")).rejects.toBeInstanceOf(LoginError);
  });

  it("uses the employee ID as login and sends no mail when there is no email", async () => {
    const before = mail.sent.length;
    const s = await new StaffService(a.as.admin).create(person({ email: undefined, employeeId: "NOMAIL1" }));
    expect(s.emailed).toBe(false);
    expect(mail.sent.length).toBe(before);
    const [u] = await withSchool(a.id, (tx) => tx.select().from(users).where(eq(users.id, s.id)));
    expect(u!.loginId).toBe("NOMAIL1");
    await expect(new StaffService(a.as.admin).resendInvite(s.id)).rejects.toMatchObject({ fieldErrors: { email: expect.any(String) } });
  });

  it("rejects a duplicate employee ID or email with a field error", async () => {
    const svc = new StaffService(a.as.admin);
    await svc.create(person({ employeeId: "DUP1", email: "dup1@a.test" }));
    await expect(svc.create(person({ employeeId: "DUP1" }))).rejects.toMatchObject({ fieldErrors: { employeeId: expect.any(String) } });
    await expect(svc.create(person({ email: "dup1@a.test" }))).rejects.toMatchObject({ fieldErrors: { email: expect.any(String) } });
  });

  it("validates input and only allows staff roles", async () => {
    const svc = new StaffService(a.as.admin);
    await expect(svc.create(person({ role: "student" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create(person({ name: "" }))).rejects.toMatchObject({ fieldErrors: { name: expect.any(String) } });
  });

  it("resend invite replaces the old link; an active user cannot be re-invited", async () => {
    const svc = new StaffService(a.as.admin);
    const s = await svc.create(person());
    const first = mail.sent.at(-1)!;
    expect((await svc.resendInvite(s.id)).emailed).toBe(true);
    const second = mail.sent.at(-1)!;
    expect(tokenIn(second)).not.toBe(tokenIn(first));
    await expect(new SchoolAuth(a.id).resetPassword(tokenIn(first), "whatever-pass1")).rejects.toBeInstanceOf(LoginError);
    await new SchoolAuth(a.id).resetPassword(tokenIn(second), "whatever-pass1");
    await expect(svc.resendInvite(s.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("deactivate disables the login, ends sessions and kills unused invites", async () => {
    const svc = new StaffService(a.as.admin);
    const active = await svc.create(person({ email: "gone@a.test" }));
    const activeInvite = mail.sent.at(-1)!;
    const auth = new SchoolAuth(a.id);
    await auth.resetPassword(tokenIn(activeInvite), "gone-pass-123");
    await auth.login("gone@a.test", "gone-pass-123");

    const out = await svc.deactivate(active.id);
    expect(out.state).toBe("left");
    expect(await withSchool(a.id, (tx) => tx.select().from(sessions).where(eq(sessions.userId, active.id)))).toHaveLength(0);
    await expect(auth.login("gone@a.test", "gone-pass-123")).rejects.toMatchObject({ reason: "disabled" });

    const invited = await svc.create(person());
    const link = tokenIn(mail.sent.at(-1)!);
    await svc.deactivate(invited.id);
    await expect(auth.resetPassword(link, "revived-pass-1")).rejects.toBeInstanceOf(LoginError);
    expect((await svc.get(invited.id)).state).toBe("left");
  });

  it("you cannot deactivate or re-role yourself", async () => {
    const svc = new StaffService(a.as.admin);
    await expect(svc.deactivate(a.users.admin)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.changeRole(a.users.admin, { role: "teacher" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("changes role between staff roles only", async () => {
    const svc = new StaffService(a.as.admin);
    const s = await svc.create(person());
    expect((await svc.changeRole(s.id, { role: "accountant" })).role).toBe("accountant");
    await expect(svc.changeRole(s.id, { role: "parent" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("edit updates the login and the profile together", async () => {
    const svc = new StaffService(a.as.admin);
    const s = await svc.create(person({ phone: "9876500001" }));
    const u = await svc.update(s.id, { name: "Renamed Person", employeeId: s.employeeId, email: s.email, phone: "9876500002", department: "Maths", address: "12 MG Road, Pune" });
    expect(u).toMatchObject({ name: "Renamed Person", phone: "9876500002", department: "Maths", address: "12 MG Road, Pune", designation: null });
  });

  it("changing the email moves the login with it", async () => {
    const svc = new StaffService(a.as.admin);
    const s = await svc.create(person({ email: "old.mail@a.test" }));
    await svc.update(s.id, { name: s.name, employeeId: s.employeeId, email: "new.mail@a.test" });
    const [u] = await withSchool(a.id, (tx) => tx.select().from(users).where(eq(users.id, s.id)));
    expect(u).toMatchObject({ email: "new.mail@a.test", loginId: "new.mail@a.test" });
  });

  it("lists with search, role, department and status filters", async () => {
    const svc = new StaffService(a.as.admin);
    await svc.create(person({ name: "Zed Findable", role: "accountant", department: "Accounts", employeeId: "ACC9" }));
    const find = async (q: Record<string, unknown>) => (await svc.list(q)).rows.map((r) => r.name);
    expect(await find({ q: "Findable" })).toEqual(["Zed Findable"]);
    expect(await find({ filters: { role: "accountant", department: "Accounts" } })).toContain("Zed Findable");
    expect((await svc.list({ filters: { role: "accountant" } })).rows.every((r) => r.role === "accountant")).toBe(true);
    expect((await svc.list({ filters: { status: "left" } })).rows.every((r) => r.state === "left")).toBe(true);
    expect(await svc.departments()).toContain("Accounts");
  });

  it("get lists what a teacher teaches and which sections they lead", async () => {
    const svc = new StaffService(a.as.admin);
    const t = await svc.create(person({ name: "Meera Iyer" }));
    await withSchool(a.id, async (tx) => {
      const [y] = await tx.insert(academicYears).values({ schoolId: a.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
      const [c] = await tx.insert(classes).values({ schoolId: a.id, name: "Class 5", grade: 5 }).returning();
      const [sec] = await tx.insert(sections).values({ schoolId: a.id, classId: c!.id, yearId: y!.id, name: "A", classTeacherId: t.id }).returning();
      const [sub] = await tx.insert(subjects).values({ schoolId: a.id, name: "Mathematics" }).returning();
      await tx.insert(sectionTeachers).values({ schoolId: a.id, sectionId: sec!.id, subjectId: sub!.id, teacherId: t.id });
    });
    const got = await svc.get(t.id);
    expect(got.teaches).toEqual([expect.objectContaining({ section: "Class 5-A", subject: "Mathematics", year: "2026-27" })]);
    expect(got.classTeacherOf).toEqual([expect.objectContaining({ section: "Class 5-A" })]);
  });

  it("counts people by state, suggests the next employee ID and lists the subjects teachers teach", async () => {
    const svc = new StaffService(a.as.admin);
    await svc.create(person({ employeeId: "Z041" }));
    expect(await svc.nextEmployeeId()).toBe("Z042");
    const c = await svc.counts();
    expect(c.total).toBe(c.active + c.invited);
    expect(c.invited).toBeGreaterThan(0);
    expect(c.left).toBeGreaterThanOrEqual(0);
    const t = await svc.create(person({ name: "Subject Lister" }));
    await withSchool(a.id, async (tx) => {
      const [sub] = await tx.insert(subjects).values({ schoolId: a.id, name: "Chemistry" }).returning();
      const [sec] = await tx.select().from(sections).limit(1);
      if (sec) await tx.insert(sectionTeachers).values({ schoolId: a.id, sectionId: sec.id, subjectId: sub!.id, teacherId: t.id });
    });
    const row = (await svc.list({ q: "Subject Lister" })).rows[0]!;
    expect(Array.isArray(row.subjects)).toBe(true);
  });

  it("reactivate brings a deactivated person back, with a fresh invite when they never set a password", async () => {
    const svc = new StaffService(a.as.admin);
    const auth = new SchoolAuth(a.id);
    const was = await svc.create(person({ email: "back@a.test" }));
    await auth.resetPassword(tokenIn(mail.sent.at(-1)!), "back-pass-123");
    await svc.deactivate(was.id);
    expect((await svc.reactivate(was.id)).state).toBe("active");
    expect((await auth.login("back@a.test", "back-pass-123")).token).toBeTruthy();
    await expect(svc.reactivate(was.id)).rejects.toBeInstanceOf(ConflictError);

    const never = await svc.create(person({ email: "never@a.test" }));
    await svc.deactivate(never.id);
    const before = mail.sent.length;
    const out = await svc.reactivate(never.id);
    expect(out).toMatchObject({ state: "invited", emailed: true });
    expect(mail.sent.length).toBe(before + 1);
    await expect(new StaffService(a.as.teacher).reactivate(never.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("permissions: teachers and accountants read, only admins write", async () => {
    const admin = await new StaffService(a.as.admin).create(person());
    for (const ctx of [a.as.teacher, a.as.accountant]) {
      const svc = new StaffService(ctx);
      expect((await svc.list()).rows.length).toBeGreaterThan(0);
      await expect(svc.get(admin.id)).resolves.toBeTruthy();
      await expect(svc.create(person())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc.update(admin.id, person())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc.changeRole(admin.id, { role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc.resendInvite(admin.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc.deactivate(admin.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    for (const ctx of [a.as.student, a.as.parent]) {
      await expect(new StaffService(ctx).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new StaffService(ctx).get(admin.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("isolation: school B cannot list, get, update, re-role, invite or deactivate school A's staff", async () => {
    const x = await new StaffService(a.as.admin).create(person({ name: "A Only Person" }));
    const bSvc = new StaffService(b.as.admin);
    expect((await bSvc.list({ q: "A Only Person" })).rows).toHaveLength(0);
    await expect(bSvc.get(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.update(x.id, person({ name: "Hacked" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.changeRole(x.id, { role: "admin" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.resendInvite(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.deactivate(x.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new StaffService(a.as.admin).get(x.id)).name).toBe("A Only Person");
  });
});
