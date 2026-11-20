import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SchoolAuth, LoginError } from "@smw/auth";
import { auditLogs, closeDb, count, eq, users, withSchool } from "@smw/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections, sectionTeachers, subjects } from "@smw/feature-academics/schema";
import { MemoryEmailSender, useServices } from "@smw/integrations";
import { StaffService } from "./service";
import { staffProfiles } from "./schema";

let a: TestSchool, b: TestSchool;
const mail = new MemoryEmailSender();
const csv = (...lines: string[]) => ({ name: "staff.csv", bytes: new TextEncoder().encode(lines.join("\n")) });
const HEAD = "name,email,phone,role,employee_id,designation,joining_date";
const tokenIn = (text: string) => /token=([\w-]+)/.exec(text)![1]!;

beforeAll(async () => {
  useServices({ email: mail });
  ({ a, b } = await createSchoolPair(["academics", "staff"], "ppl"));
});
afterAll(closeDb);

const asStaff = (s: TestSchool, userId: string, role: "teacher" | "accountant" = "teacher") => ({ ...s.as[role], userId });

describe("my record", () => {
  it("updateMyContact changes only the allowed fields, logs them, and only the caller's own row", async () => {
    const svc = new StaffService(a.as.admin);
    const me = await svc.create({ name: "Me Teacher", role: "teacher", employeeId: "MY1", email: "my1@appl.test", designation: "TGT" });
    const other = await svc.create({ name: "Other Teacher", role: "teacher", employeeId: "MY2", email: "my2@appl.test", phone: "9876500002", designation: "PGT" });
    const mine = new StaffService(asStaff(a, me.id));

    const out = await mine.updateMyContact({
      phone: "9876500001", address: "12 Lake Road", emergencyName: "Asha", emergencyPhone: "9876500009", qualification: "M.Sc.",
      designation: "Principal", name: "Hacked", employeeId: "HACK", email: "hack@appl.test", role: "admin",
    });
    expect(out).toMatchObject({ phone: "9876500001", address: "12 Lake Road", emergencyName: "Asha", qualification: "M.Sc.", designation: "TGT", employeeId: "MY1", name: "Me Teacher" });
    const after = await svc.get(me.id);
    expect(after).toMatchObject({ designation: "TGT", email: "my1@appl.test", role: "teacher", phone: "9876500001" });
    expect(await svc.get(other.id)).toMatchObject({ phone: "9876500002", address: null, designation: "PGT" });

    const logs = await withSchool(a.id, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.entityId, me.id)));
    const log = logs.find((l) => l.action === "update_contact")!;
    expect(log).toMatchObject({ actorUserId: me.id, module: "staff" });
    expect((log.meta as { fields: string[] }).fields.sort()).toEqual(["address", "emergencyName", "emergencyPhone", "phone", "qualification"]);

    // No change, no audit row.
    await mine.updateMyContact({ phone: "9876500001", address: "12 Lake Road", emergencyName: "Asha", emergencyPhone: "9876500009", qualification: "M.Sc." });
    const again = await withSchool(a.id, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.entityId, me.id)));
    expect(again.filter((l) => l.action === "update_contact")).toHaveLength(1);
    await expect(mine.updateMyContact({ phone: "123" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("has nothing for people without a staff profile", async () => {
    expect(await new StaffService(a.as.student).myRecord()).toBeNull();
    await expect(new StaffService(a.as.student).updateMyContact({ phone: "9876500003" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a teacher sees the sections they are class teacher of and their subjects", async () => {
    const t = await new StaffService(a.as.admin).create({ name: "Class Teacher", role: "teacher", employeeId: "MY3", email: "my3@appl.test" });
    await withSchool(a.id, async (tx) => {
      const [yr] = await tx.insert(academicYears).values({ schoolId: a.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
      const [cls] = await tx.insert(classes).values({ schoolId: a.id, name: "Class 6", grade: 6 }).returning();
      const [sec] = await tx.insert(sections).values({ schoolId: a.id, classId: cls!.id, yearId: yr!.id, name: "A", classTeacherId: t.id }).returning();
      const subs = await tx.insert(subjects).values([{ schoolId: a.id, name: "Maths" }, { schoolId: a.id, name: "Physics" }]).returning();
      await tx.insert(sectionTeachers).values(subs.map((s) => ({ schoolId: a.id, sectionId: sec!.id, subjectId: s.id, teacherId: t.id })));
    });
    const r = (await new StaffService(asStaff(a, t.id)).myRecord())!;
    expect(r).toMatchObject({ employeeId: "MY3", role: "teacher" });
    expect(r.teaching!.classTeacherOf.map((c) => c.section)).toEqual(["Class 6-A"]);
    expect(r.teaching!.teaches.map((x) => `${x.section}:${x.subject}`).sort()).toEqual(["Class 6-A:Maths", "Class 6-A:Physics"]);
    expect(r.teaching!.weeklyPeriods).toBeNull();
    // An accountant has a record but no teaching panel.
    const acc = await new StaffService(a.as.admin).create({ name: "Acc One", role: "accountant", employeeId: "MY4", email: "my4@appl.test" });
    expect((await new StaffService(asStaff(a, acc.id, "accountant")).myRecord())!.teaching).toBeNull();
  });
});

describe("staff import", () => {
  it("the dry run reports unknown role, duplicate email and bad date by line, and .xlsx equals .csv", async () => {
    const svc = new StaffService(a.as.admin);
    const fromCsv = await svc.importCheck(csv(HEAD,
      "Anita Rao,anita@appl.test,,Teacher,,TGT,01-06-2024",
      "Bad Role,,,Wizard,,,",
      "Dup Mail,anita@appl.test,,Teacher,,,",
      "Bad Date,,,Teacher,,,31-02-2024"));
    const fromXlsx = await svc.importCheck({ name: "staff.xlsx", bytes: new Uint8Array(readFileSync(new URL("./fixtures/staff-import.xlsx", import.meta.url))) });
    expect(fromXlsx).toEqual(fromCsv);
    expect(fromCsv).toMatchObject({ total: 4, valid: 1, failed: 3 });
    const errs = Object.fromEntries(fromCsv.rows.map((r) => [r.line, r.errors.map((e) => e.column)]));
    expect(errs).toEqual({ 2: [], 3: ["role"], 4: ["email"], 5: ["joining_date"] });
    expect(fromCsv.rows[1]!.errors[0]!.message).toContain("Wizard");
    // Nothing was written.
    expect((await svc.list({ q: "Anita Rao" })).rows).toHaveLength(0);
  });

  it("flags clashes with people already in the school and repeated employee IDs", async () => {
    const svc = new StaffService(a.as.admin);
    await svc.create({ name: "Taken", role: "teacher", employeeId: "IMP-TAKEN", email: "taken@appl.test", phone: "9876511111" });
    const r = await svc.importCheck(csv(HEAD,
      "Xx,taken@appl.test,,Teacher,,,", "Yy,,9876511111,Teacher,,,", "Zz,,,Teacher,IMP-TAKEN,,", "Pp,,,Teacher,IMP-P,,", "Qq,,,Teacher,IMP-P,,"));
    expect(r.rows.map((x) => x.errors.map((e) => e.column))).toEqual([["email"], ["phone"], ["employee_id"], [], ["employee_id"]]);
  });

  it("commit creates 3 people in one go: 1 invite mail, 2 access links that work once", async () => {
    const svc = new StaffService(a.as.admin);
    const before = mail.sent.length;
    const out = await svc.importCommit(csv(HEAD,
      "Mail Person,mailp@appl.test,,Teacher,,TGT,01-06-2024",
      "Link One,,,Teacher,,,",
      "Link Two,,,Accountant,,,"));
    expect(out.imported).toBe(3);
    expect(mail.sent.length).toBe(before + 1);
    expect(mail.sent.at(-1)!.to).toBe("mailp@appl.test");
    const [m, l1, l2] = out.people;
    expect(m).toMatchObject({ emailed: true, accessLink: null, loginId: "mailp@appl.test", role: "Teacher" });
    expect(l1!.accessLink).toBeTruthy();
    expect(l2).toMatchObject({ role: "Accountant", emailed: false });
    expect(new Set(out.people.map((p) => p.loginId)).size).toBe(3);

    const rows = (await svc.list({ q: "Link " })).rows;
    expect(rows.map((r) => r.role).sort()).toEqual(["accountant", "teacher"]);
    const auth = new SchoolAuth(a.id);
    for (const p of [l1!, l2!]) {
      await auth.resetPassword(tokenIn(p.accessLink!), "import-pass-1");
      expect((await auth.login(p.loginId, "import-pass-1")).token).toBeTruthy();
      await expect(auth.resetPassword(tokenIn(p.accessLink!), "import-pass-2")).rejects.toBeInstanceOf(LoginError);
    }
  });

  it("is all or nothing: one bad row writes nobody", async () => {
    const svc = new StaffService(a.as.admin);
    const n = async () => Number((await withSchool(a.id, (tx) => tx.select({ n: count() }).from(staffProfiles)))[0]!.n);
    const before = await n();
    await expect(svc.importCommit(csv(HEAD, "Good One,,,Teacher,,,", "Bad One,,,Wizard,,,"))).rejects.toBeInstanceOf(ValidationError);
    expect(await n()).toBe(before);
    await expect(svc.importCommit(csv("name,email", "x,y"))).rejects.toMatchObject({ fieldErrors: { file: expect.any(String) } });
  });

  it("a non-admin with staff:write cannot import an Admin row", async () => {
    const svc = new StaffService({ ...a.as.admin, role: "accountant", userId: a.users.accountant, grants: new Set(["staff:read", "staff:write"]) });
    const r = await svc.importCheck(csv(HEAD, "Sneaky,,,Admin,,,", "Fine,,,Teacher,,,"));
    expect(r.rows[0]!.errors[0]).toMatchObject({ column: "role", message: expect.stringContaining("admin") });
    expect(r.rows[1]!.errors).toEqual([]);
    await expect(svc.importCommit(csv(HEAD, "Sneaky,,,Admin,,,"))).rejects.toBeInstanceOf(ValidationError);
    await expect(new StaffService(a.as.teacher).importCheck(csv(HEAD, "X,,,Teacher,,,"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("isolation: school B does not see A's people as duplicates and cannot reach A's records", async () => {
    const r = await new StaffService(b.as.admin).importCheck(csv(HEAD, "Same,mailp@appl.test,,Teacher,,,"));
    expect(r.failed).toBe(0);
    const [t] = await withSchool(a.id, (tx) => tx.select().from(users).where(eq(users.loginId, "mailp@appl.test")));
    expect(await new StaffService(asStaff(b, t!.id)).myRecord()).toBeNull();
    await expect(new StaffService(asStaff(b, t!.id)).updateMyContact({ phone: "9876500077" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
