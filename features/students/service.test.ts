import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Passwords } from "@smw/auth";
import { closeDb, eq, schools, sessions, users, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, LimitError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { createTestSchool, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import academicsFeature from "@smw/feature-academics/feature";
import studentsFeature from "./feature";
import {
  ConsentService, CredentialService, DocumentService, GuardianService, ImportService, LifecycleService, PhotoService, PromotionService, StudentSelfService, StudentService,
} from "./service";
import { auditLogs } from "@smw/db";
import { guardians, studentEnrollments, students } from "./schema";
import seedStudents from "./seed";

const FEATURES = ["academics", "students"];
const storage = new MemoryStorage();
const png = (name = "x.png") => ({ name, type: "image/png", bytes: new Uint8Array([1, 2, 3]) });

let a: TestSchool, b: TestSchool;
let yearNow: string, yearNext: string;
let c4: string, c5: string, c12: string;
let s4A: string, s12A: string, s5Anext: string, s4Anext: string;

async function setupAcademics(schoolId: string) {
  return withSchool(schoolId, async (tx) => {
    const [y1] = await tx.insert(academicYears).values({ schoolId, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [y2] = await tx.insert(academicYears).values({ schoolId, name: "2027-28", startsOn: "2027-04-01", endsOn: "2028-03-31", isCurrent: false }).returning();
    const cls = await tx.insert(classes).values([{ schoolId, name: "Class 4", grade: 4 }, { schoolId, name: "Class 5", grade: 5 }, { schoolId, name: "Class 12", grade: 12 }]).returning();
    const sec = (classId: string, yearId: string, name = "A") => ({ schoolId, classId, yearId, name });
    const [x4, x12, y5, y4] = await tx.insert(sections).values([
      sec(cls[0]!.id, y1!.id), sec(cls[2]!.id, y1!.id), sec(cls[1]!.id, y2!.id), sec(cls[0]!.id, y2!.id),
    ]).returning();
    return { yearNow: y1!.id, yearNext: y2!.id, c4: cls[0]!.id, c5: cls[1]!.id, c12: cls[2]!.id, s4A: x4!.id, s12A: x12!.id, s5Anext: y5!.id, s4Anext: y4!.id };
  });
}

beforeAll(async () => {
  useServices({ storage });
  await registerFeatures([academicsFeature, studentsFeature]);
  a = await createTestSchool("greenvalley", FEATURES);
  b = await createTestSchool("sunrise", FEATURES);
  ({ yearNow, yearNext, c4, c5, c12, s4A, s12A, s5Anext, s4Anext } = await setupAcademics(a.id));
});
afterAll(closeDb);

const asAdmin = (s: TestSchool) => new StudentService(s.as.admin);
const loginOf = (schoolId: string, userId: string) => withSchool(schoolId, async (tx) => (await tx.select().from(users).where(eq(users.id, userId)))[0]!);
const asStudent = (userId: string): Ctx => ({ ...a.as.student, userId });

describe("admission", () => {
  it("numbers from the first two letters of the school slug, logs the student in with the date of birth, and enrols in the current year", async () => {
    const s = await asAdmin(a).create({ name: "Aarav Sharma", dob: "2015-06-14", gender: "male", sectionId: s4A });
    expect(s.admissionNo).toBe("GR0001");
    const next = await asAdmin(a).create({ name: "Diya Verma", sectionId: s4A });
    expect(next.admissionNo).toBe("GR0002");
    expect([s.rollNo, next.rollNo]).toEqual([1, 2]);
    expect(s.classId).toBe(c4);

    const login = await loginOf(a.id, s.userId!);
    expect(login).toMatchObject({ role: "student", loginId: "GR0001", status: "active", mustChangePassword: true });
    expect(await Passwords.verify(login.passwordHash, "14062015")).toBe(true);
    // No date of birth: the admission number is the first password.
    expect(await Passwords.verify((await loginOf(a.id, next.userId!)).passwordHash, "GR0002")).toBe(true);

    const enrol = await withSchool(a.id, (tx) => tx.select().from(studentEnrollments).where(eq(studentEnrollments.studentId, s.id)));
    expect(enrol).toHaveLength(1);
    expect(enrol[0]).toMatchObject({ yearId: yearNow, sectionId: s4A, rollNo: 1, outcome: "studying" });
  });

  it("records an RTE quota seat from the Yes/No select, and an edit without it keeps the flag", async () => {
    const svc = asAdmin(a);
    const s = await svc.create({ name: "Ishaan Rao", admissionNo: "RTE-1", sectionId: s4A, rteQuota: "true" });
    expect(s.rteQuota).toBe(true);
    expect((await svc.update(s.id, { name: "Ishaan Rao" })).rteQuota).toBe(true); // not on the form: unchanged
    expect((await svc.update(s.id, { rteQuota: "false" })).rteQuota).toBe(false);
    expect((await svc.create({ name: "Riya Sen", admissionNo: "RTE-2", sectionId: s4A })).rteQuota).toBe(false);
  });

  it("keeps a typed admission number, rejects a duplicate, and skips it when numbering", async () => {
    await asAdmin(a).create({ admissionNo: "GR0004", name: "Manual Entry", sectionId: s4A });
    await expect(asAdmin(a).create({ admissionNo: "GR0004", name: "Again" })).rejects.toBeInstanceOf(ConflictError);
    const auto = await asAdmin(a).create({ name: "Auto Three", sectionId: s4A });
    expect(auto.admissionNo).toBe("GR0003");
    const skipped = await asAdmin(a).create({ name: "Auto Five", sectionId: s4A });
    expect(skipped.admissionNo).toBe("GR0005");
  });

  it("validates input with plain messages", async () => {
    await expect(asAdmin(a).create({ name: "" })).rejects.toMatchObject({ fieldErrors: { name: expect.any(String) } });
    await expect(asAdmin(a).create({ name: "Kabir Rao", guardianName: "Mr Rao" })).rejects.toMatchObject({ fieldErrors: { guardianPhone: expect.any(String) } });
    await expect(asAdmin(a).create({ name: "Kabir Rao", sectionId: "7b0f2a2e-0000-4000-8000-000000000000" })).rejects.toMatchObject({ fieldErrors: { sectionId: expect.any(String) } });
  });

  it("saves the guardian as a contact only (no login), and one guardian covers two children", async () => {
    const usersBefore = await withSchool(a.id, async (tx) => (await tx.select().from(users)).length);
    const one = await asAdmin(a).create({ name: "Sibling One", sectionId: s4A, guardianName: "Rakesh Gupta", guardianPhone: "9811100001", guardianRelation: "father" });
    const two = await asAdmin(a).create({ name: "Sibling Two", sectionId: s12A, guardianName: "Rakesh Gupta", guardianPhone: "+91 9811100001", guardianRelation: "father" });
    const g = new GuardianService(a.as.admin);
    const [g1] = await g.forStudent(one.id), [g2] = await g.forStudent(two.id);
    expect(g1).toMatchObject({ phone: "9811100001", isPrimary: true });
    expect(g2!.id).toBe(g1!.id);

    const [row] = await withSchool(a.id, (tx) => tx.select().from(guardians).where(eq(guardians.id, g1!.id)));
    expect(row!.userId).toBeNull();
    // Only the two student logins were added: no parent user exists for the guardian.
    const after = await withSchool(a.id, (tx) => tx.select().from(users));
    expect(after.length).toBe(usersBefore + 2);
    expect(after.some((u) => u.role === "parent" && u.loginId === "9811100001")).toBe(false);
  });

  it("a guardian phone that belongs to a staff login is still just a contact", async () => {
    await withSchool(a.id, (tx) => tx.update(users).set({ phone: "9000000001" }).where(eq(users.id, a.users.teacher)));
    const kid = await asAdmin(a).create({ name: "Clash Kid", guardianName: "Someone", guardianPhone: "9000000001" });
    const [g] = await new GuardianService(a.as.admin).forStudent(kid.id);
    expect(g).toMatchObject({ phone: "9000000001", userId: null });
  });

  it("only admins admit students", async () => {
    for (const role of ["teacher", "accountant", "student", "parent"] as const) {
      await expect(new StudentService(a.as[role]).create({ name: "Nope Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("student cap", () => {
  it("warns from 90% and blocks past 110%", async () => {
    const school = await createTestSchool("capschool", FEATURES);
    await withConsole((tx) => tx.update(schools).set({ studentCap: 10 }).where(eq(schools.id, school.id)));
    const svc = new StudentService(school.as.admin);
    const flags: boolean[] = [];
    for (let i = 1; i <= 11; i++) flags.push((await svc.admit({ name: `Kid Number ${i}` })).capacity.warning);
    expect(flags.slice(0, 8)).toEqual(Array(8).fill(false));
    expect(flags.slice(8)).toEqual([true, true, true]);
    await expect(svc.admit({ name: "One Too Many" })).rejects.toBeInstanceOf(LimitError);
    expect(await svc.capacity()).toMatchObject({ active: 11, cap: 10, hardLimit: 11, blocked: true });
  }, 60_000);
});

describe("who sees which students", () => {
  it("a student sees only themselves, and a legacy parent login sees nothing", async () => {
    const mine = await asAdmin(a).create({ name: "Scoped Child", sectionId: s4A, guardianName: "Scoped Parent", guardianPhone: "9822200001" });
    await asAdmin(a).create({ name: "Someone Else", sectionId: s4A, guardianName: "Other Parent", guardianPhone: "9822200002" });
    const other = (await asAdmin(a).list({ q: "Someone Else" })).rows[0]!;
    await expect(new StudentService(a.as.parent).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new GuardianService(asStudent(mine.userId!)).forStudent(other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new GuardianService(asStudent(mine.userId!)).listParents()).rejects.toBeInstanceOf(ForbiddenError);

    const studentView = new StudentService(asStudent(mine.userId!));
    expect((await studentView.list()).rows.map((r) => r.id)).toEqual([mine.id]);
    await expect(studentView.get(other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(studentView.update(mine.id, { name: "Renamed" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(studentView.remove(mine.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("teachers and accountants can read but not change", async () => {
    for (const role of ["teacher", "accountant"] as const) {
      const svc = new StudentService(a.as[role]);
      expect((await svc.list()).total).toBeGreaterThan(0);
      const first = (await svc.list()).rows[0]!;
      await expect(svc.update(first.id, { name: "Changed" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc.remove(first.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("filters by section, status and gender, and searches name and admission number", async () => {
    const svc = asAdmin(a);
    expect((await svc.list({ filters: { sectionId: s12A } })).rows.map((r) => r.name)).toEqual(["Sibling Two"]);
    expect((await svc.list({ q: "GR0001" })).rows.map((r) => r.name)).toEqual(["Aarav Sharma"]);
    expect((await svc.list({ filters: { gender: "male", status: "active" } })).rows.every((r) => r.gender === "male")).toBe(true);
    expect((await svc.list({ filters: { sectionId: "not-a-uuid" } })).total).toBeGreaterThan(0); // a bad filter is ignored, not a crash
    const view = await svc.listView({ q: "Sibling One" });
    expect(view.rows[0]).toMatchObject({ classSection: "4-A", guardianName: "Rakesh Gupta", guardianPhone: "9811100001" });
  });
});

describe("edit and delete", () => {
  it("moving a section re-rolls the student and updates the enrolment; blank fields clear", async () => {
    const s = await asAdmin(a).create({ name: "Mover Singh", address: "12 MG Road", sectionId: s4A });
    const moved = await asAdmin(a).update(s.id, { name: "Mover Singh", sectionId: s12A, address: undefined });
    expect(moved).toMatchObject({ sectionId: s12A, classId: c12, address: null });
    expect(moved.rollNo).toBeGreaterThan(0);
    const [enrol] = await withSchool(a.id, (tx) => tx.select().from(studentEnrollments).where(eq(studentEnrollments.studentId, s.id)));
    expect(enrol).toMatchObject({ sectionId: s12A, classId: c12 });
    await new LifecycleService(a.as.admin).markLeft(s.id, { reason: "changed_school" });
    expect((await asAdmin(a).get(s.id)).leftOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("deleting a student removes the login and a parent with no other child", async () => {
    const s = await asAdmin(a).create({ name: "Short Stay", sectionId: s4A, guardianName: "Lone Parent", guardianPhone: "9833300001" });
    const parentRow = (await new GuardianService(a.as.admin).forStudent(s.id))[0]!;
    await asAdmin(a).remove(s.id);
    await expect(asAdmin(a).get(s.id)).rejects.toBeInstanceOf(NotFoundError);
    const state = await withSchool(a.id, async (tx) => ({
      login: await tx.select().from(users).where(eq(users.id, s.userId!)),
      parent: await tx.select().from(guardians).where(eq(guardians.id, parentRow.id)),
    }));
    expect(state.login).toHaveLength(0);
    expect(state.parent).toHaveLength(0);
  });

  it("refuses to delete a student who has money records, and keeps their login and files", async () => {
    const s = await asAdmin(a).create({ name: "Has Fees", sectionId: s4A, guardianName: "Fee Parent", guardianPhone: "9833300002" });
    await withSchool(a.id, (tx) => tx.execute(sql`insert into fee_advances (id, school_id, student_id, kind, amount_paise, date) values (gen_random_uuid(), ${a.id}, ${s.id}, 'opening', 100, '2026-04-01')`));
    await expect(asAdmin(a).remove(s.id)).rejects.toThrow(/advances or deposits/);
    await expect(asAdmin(a).remove(s.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await asAdmin(a).get(s.id)).id).toBe(s.id);
    expect(await withSchool(a.id, (tx) => tx.select().from(users).where(eq(users.id, s.userId!)))).toHaveLength(1);
  });
});

describe("guardians", () => {
  it("add, change the primary, and remove", async () => {
    const s = await asAdmin(a).create({ name: "Family Test", sectionId: s4A, guardianName: "Father Test", guardianPhone: "9844400001", guardianRelation: "father" });
    const svc = new GuardianService(a.as.admin);
    const mother = await svc.add({ studentId: s.id, name: "Mother Test", relation: "mother", phone: "9844400002" });
    expect((await svc.forStudent(s.id)).map((g) => [g.name, g.isPrimary])).toEqual([["Father Test", true], ["Mother Test", false]]);
    await expect(svc.add({ studentId: s.id, name: "Mother Test", relation: "mother", phone: "9844400002" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.add({ studentId: s.id, name: "Bad", phone: "12345" })).rejects.toMatchObject({ fieldErrors: { phone: expect.any(String) } });

    await svc.setPrimary({ studentId: s.id, guardianId: mother.id });
    expect((await svc.forStudent(s.id))[0]!.name).toBe("Mother Test");
    await svc.remove({ studentId: s.id, guardianId: mother.id });
    const rest = await svc.forStudent(s.id);
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({ name: "Father Test", isPrimary: true });
  });

  it("the parents list shows each parent with their children", async () => {
    const page = await new GuardianService(a.as.admin).listParents({ q: "Rakesh" });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]!.children.map((c) => c.name)).toEqual(["Sibling One", "Sibling Two"]);
    expect(page.rows[0]!.children[0]!.classSection).toBe("4-A");
  });

  it("teachers cannot add guardians", async () => {
    const s = (await asAdmin(a).list()).rows[0]!;
    await expect(new GuardianService(a.as.teacher).add({ studentId: s.id, name: "Nope Nope", phone: "9855500001" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("consent, documents and photo", () => {
  it("keeps the latest answer per purpose and the full history", async () => {
    const s = await asAdmin(a).create({ name: "Consent Kid", sectionId: s4A, guardianName: "Consent Mom", guardianPhone: "9866600001" });
    const svc = new ConsentService(a.as.admin);
    await svc.record({ studentId: s.id, purpose: "photo_on_website", granted: "true", method: "paper_form" });
    await svc.record({ studentId: s.id, purpose: "photo_on_website", granted: "false", method: "in_person" });
    await svc.record({ studentId: s.id, purpose: "data_processing", granted: "true" });
    const { current, history } = await svc.forStudent(s.id);
    expect(history).toHaveLength(3);
    expect(current.find((c) => c.purpose === "photo_on_website")).toMatchObject({ granted: false, method: "in_person" });
    expect(current.find((c) => c.purpose === "data_processing")?.granted).toBe(true);
    expect(current.find((c) => c.purpose === "trips_outings")?.granted).toBeNull();

    const stranger = (await new GuardianService(a.as.admin).forStudent((await asAdmin(a).list({ q: "Sibling One" })).rows[0]!.id))[0]!;
    await expect(svc.record({ studentId: s.id, purpose: "trips_outings", granted: "true", guardianId: stranger.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(new ConsentService(a.as.teacher).record({ studentId: s.id, purpose: "trips_outings", granted: "true" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("stores documents privately under the school, lists signed links, and deletes the file", async () => {
    const s = await asAdmin(a).create({ name: "Docs Kid", sectionId: s4A, guardianName: "Docs Dad", guardianPhone: "9877700001" });
    const svc = new DocumentService(a.as.admin);
    const doc = await svc.upload({ studentId: s.id, kind: "birth_certificate" }, { name: "Birth Cert.pdf", type: "application/pdf", bytes: new Uint8Array([1, 2, 3, 4]) });
    expect(doc.fileKey.startsWith(`${a.id}/students/`)).toBe(true);
    expect(storage.files.has(doc.fileKey)).toBe(true);
    const [listed] = await svc.list(s.id);
    expect(listed).toMatchObject({ fileName: "Birth Cert.pdf", kind: "birth_certificate", size: 4 });
    expect(listed!.url).toContain(doc.fileKey);

    await expect(svc.upload({ studentId: s.id, kind: "other" }, { name: "x.exe", type: "application/x-msdownload", bytes: new Uint8Array([1]) })).rejects.toMatchObject({ fieldErrors: { file: expect.any(String) } });

    const own = asStudent(s.userId!);
    expect(await new DocumentService(own).list(s.id)).toHaveLength(1);
    await expect(new DocumentService(own).upload({ studentId: s.id, kind: "other" }, png())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new DocumentService(own).remove(doc.id)).rejects.toBeInstanceOf(ForbiddenError);

    await svc.remove(doc.id);
    expect(storage.files.has(doc.fileKey)).toBe(false);
    expect(await svc.list(s.id)).toHaveLength(0);
  });

  it("replaces the photo and removes the old file", async () => {
    const s = await asAdmin(a).create({ name: "Photo Kid", sectionId: s4A });
    const svc = new PhotoService(a.as.admin);
    expect(await svc.url(s.id)).toBeNull();
    await svc.upload(s.id, png("one.png"));
    const first = (await asAdmin(a).get(s.id)).photoKey!;
    await svc.upload(s.id, png("two.png"));
    expect(storage.files.has(first)).toBe(false);
    expect(await svc.url(s.id)).toContain((await asAdmin(a).get(s.id)).photoKey!);
    await expect(svc.upload(s.id, { name: "a.gif", type: "image/gif", bytes: new Uint8Array([1]) })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("CSV import", () => {
  const HEAD = "admission_no,name,dob,gender,class,section,guardian_name,guardian_phone,guardian_relation\n";
  const count = () => asAdmin(a).list().then((p) => p.total);

  it("the dry run lists every problem row by row and writes nothing", async () => {
    const before = await count();
    const csv = HEAD + [
      ",Good Student,2015-01-05,female,Class 4,A,Good Parent,9890000001,mother",
      "GR0001,Dup Student,2015-01-05,male,Class 4,A,,,",
      ",Lost Student,2015-01-05,male,Class 9,Z,,,",
      ",Bad Phone,2015-01-05,male,Class 4,A,Some Parent,12345,father",
      "X1,Twin One,05/01/2015,male,4,A,,,",
      "x1,Twin Two,2015-01-05,boy,Class 4,A,,,",
    ].join("\n");
    const report = await new ImportService(a.as.admin).dryRun(csv);
    expect(report).toMatchObject({ total: 6, valid: 2, failed: 4 });
    const msgs = report.rows.map((r) => r.errors.join(" | "));
    expect(msgs[0]).toBe("");
    expect(msgs[1]).toContain("already used");
    expect(msgs[2]).toContain("does not exist");
    expect(msgs[3]).toContain("guardian_phone");
    expect(msgs[4]).toBe("");
    expect(msgs[5]).toContain("appears twice");
    expect(report.rows[0]!.line).toBe(2);
    expect(await count()).toBe(before);
  });

  it("commit is all or nothing", async () => {
    const before = await count();
    const bad = HEAD + ",Fine Student,2015-01-05,male,Class 4,A,,,\n,Broken,2015-01-05,male,Class 99,A,,,";
    await expect(new ImportService(a.as.admin).commit(bad)).rejects.toMatchObject({ fieldErrors: { file: expect.stringContaining("1 of 2 rows") } });
    expect(await count()).toBe(before);

    const good = HEAD + ",Import One,2015-01-05,male,Class 4,A,Imp Parent,9890000002,father\n,Import Two,2014-02-02,female,Class 12,A,Imp Parent,9890000002,father";
    await expect(new ImportService(a.as.admin).commit(good)).resolves.toMatchObject({ imported: 2 });
    expect(await count()).toBe(before + 2);
    const parents = await new GuardianService(a.as.admin).listParents({ q: "9890000002" });
    expect(parents.rows[0]!.children).toHaveLength(2);
  });

  it("rejects a file without the needed columns, and non-admins", async () => {
    await expect(new ImportService(a.as.admin).dryRun("a,b\n1,2")).rejects.toMatchObject({ fieldErrors: { file: expect.stringContaining("missing") } });
    await expect(new ImportService(a.as.teacher).dryRun(HEAD)).rejects.toBeInstanceOf(ForbiddenError);
    expect(ImportService.templateCsv().split("\n")[0]).toMatch(new RegExp("^" + HEAD.trim()));
  });
});

describe("promotion", () => {
  it("moves a section up, holds one back, lets one leave, and writes history", async () => {
    const svc = asAdmin(a);
    const names = ["Promo One", "Promo Two", "Promo Three", "Promo Four"];
    const kids: (typeof students.$inferSelect)[] = [];
    for (const name of names) kids.push(await svc.create({ name, sectionId: s4A }));
    const promo = new PromotionService(a.as.admin);

    const preview = await promo.preview(s4A);
    expect(preview.graduating).toBe(false);
    expect(preview.promoteTargets.map((t) => t.id)).toContain(s5Anext);
    expect(preview.retainTargets.map((t) => t.id)).toEqual([s4Anext]);

    await expect(promo.promote({ fromSectionId: s4A })).rejects.toMatchObject({ fieldErrors: { toSectionId: expect.any(String) } });
    await expect(promo.promote({ fromSectionId: s4A, toSectionId: s4Anext })).rejects.toMatchObject({ fieldErrors: { toSectionId: expect.any(String) } });
    await expect(promo.promote({ fromSectionId: s4A, toSectionId: s5Anext, retainedIds: [kids[0]!.id] })).rejects.toMatchObject({ fieldErrors: { retainSectionId: expect.any(String) } });

    const inSection = (await svc.list({ filters: { sectionId: s4A } })).rows.map((r) => r.id);
    const result = await promo.promote({
      fromSectionId: s4A, toSectionId: s5Anext, retainSectionId: s4Anext,
      retainedIds: [kids[1]!.id], leftIds: [kids[2]!.id],
    });
    expect(result.retained).toBe(1);
    expect(result.left).toBe(1);
    expect(result.promoted).toBe(inSection.length - 2);

    const [up, held, gone] = await Promise.all([kids[0], kids[1], kids[2]].map((k) => svc.get(k!.id)));
    expect(up).toMatchObject({ sectionId: s5Anext, classId: c5, status: "active" });
    expect(held).toMatchObject({ sectionId: s4Anext, classId: c4 });
    expect(gone).toMatchObject({ status: "left" });
    expect(up!.rollNo).toBeGreaterThan(0);

    const history = await withSchool(a.id, (tx) => tx.select().from(studentEnrollments).where(eq(studentEnrollments.studentId, kids[0]!.id)));
    expect(history.map((h) => [h.yearId, h.outcome]).sort()).toEqual([[yearNext, "studying"], [yearNow, "promoted"]].sort());
    const heldHistory = await withSchool(a.id, (tx) => tx.select().from(studentEnrollments).where(eq(studentEnrollments.studentId, kids[1]!.id)));
    expect(heldHistory.find((h) => h.yearId === yearNow)?.outcome).toBe("retained");
  });

  it("graduates the last class as alumni", async () => {
    const svc = asAdmin(a);
    const grad = await svc.create({ name: "Final Year", sectionId: s12A });
    const promo = new PromotionService(a.as.admin);
    expect((await promo.preview(s12A)).graduating).toBe(true);
    const r = await promo.promote({ fromSectionId: s12A });
    expect(r.graduated).toBeGreaterThan(0);
    expect(await svc.get(grad.id)).toMatchObject({ status: "alumni" });
    const [old] = await withSchool(a.id, (tx) => tx.select().from(studentEnrollments).where(eq(studentEnrollments.studentId, grad.id)));
    expect(old!.outcome).toBe("graduated");
  });

  it("only admins promote", async () => {
    await expect(new PromotionService(a.as.teacher).promote({ fromSectionId: s4A })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PromotionService(a.as.parent).preview(s4A)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("review additions", () => {
  it("rejects a section of another academic year and counts reactivation against the plan cap", async () => {
    // Editing places students in this year only; a section of another year is reached by joining (A1 below), not by an edit.
    const placed = await asAdmin(a).create({ name: "Edit Year", sectionId: s4A });
    await expect(asAdmin(a).update(placed.id, { sectionId: s4Anext })).rejects.toMatchObject({ fieldErrors: { sectionId: expect.any(String) } });
    const school = await createTestSchool("capreact", FEATURES);
    await withConsole((tx) => tx.update(schools).set({ studentCap: 10 }).where(eq(schools.id, school.id)));
    const svc = new StudentService(school.as.admin);
    const first = await svc.create({ name: "Went Away" });
    await new LifecycleService(school.as.admin).markLeft(first.id, { reason: "other", note: "Went away" });
    for (let i = 1; i <= 11; i++) await svc.create({ name: `Filler Kid ${i}` });
    await expect(new LifecycleService(school.as.admin).bringBack(first.id, { sectionId: "7b0f2a2e-0000-4000-8000-000000000000" })).rejects.toBeInstanceOf(LimitError);
  }, 60_000);

  it("a student cannot read or change another student's guardians, documents, consent or photo", async () => {
    const mine = await asAdmin(a).create({ name: "Mine Child", sectionId: s4A, guardianName: "Mine Parent", guardianPhone: "9855500001" });
    const other = await asAdmin(a).create({ name: "Other Child", sectionId: s4A, guardianName: "Other Mum", guardianPhone: "9855500002" });
    const doc = await new DocumentService(a.as.admin).upload({ studentId: other.id, kind: "other" }, { name: "x.pdf", type: "application/pdf", bytes: new Uint8Array([1, 2, 3]) });
    const p = asStudent(mine.userId!);
    await expect(new DocumentService(p).list(other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ConsentService(p).forStudent(other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PhotoService(p).url(other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new DocumentService(p).list(mine.id)).resolves.toEqual([]);
    await expect(new DocumentService(p).remove(doc.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ConsentService(p).record({ studentId: mine.id, purpose: "data_processing", granted: "true" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new GuardianService(p).add({ studentId: mine.id, name: "Intruder", phone: "9855500003" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PhotoService(p).upload(mine.id, png())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ImportService(p).dryRun("name,class,section\nA B,Class 4,A")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("school B cannot reach A's documents, photo, guardian links or admission numbers through the other services", async () => {
    const x = await asAdmin(a).create({ name: "Cross Check", sectionId: s4A, guardianName: "Cross Parent", guardianPhone: "9866600001" });
    const doc = await new DocumentService(a.as.admin).upload({ studentId: x.id, kind: "other" }, { name: "y.pdf", type: "application/pdf", bytes: new Uint8Array([1]) });
    const g = (await new GuardianService(a.as.admin).forStudent(x.id))[0]!;
    await expect(new DocumentService(b.as.admin).remove(doc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new DocumentService(b.as.admin).list(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PhotoService(b.as.admin).upload(x.id, png())).rejects.toBeInstanceOf(NotFoundError);
    await expect(new GuardianService(b.as.admin).setPrimary({ studentId: x.id, guardianId: g.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new GuardianService(b.as.admin).remove({ studentId: x.id, guardianId: g.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PromotionService(b.as.admin).promote({ fromSectionId: s4A })).rejects.toBeInstanceOf(ValidationError);
    const report = await new ImportService(b.as.admin).dryRun(`admission_no,name,class,section\n${x.admissionNo},Dup Check,Class 4,A`);
    expect(report.rows[0]!.errors.some((e) => e.includes("already used"))).toBe(false);
    expect(report.rows[0]!.errors.some((e) => e.includes("does not exist"))).toBe(true);
    expect((await asAdmin(a).get(x.id)).name).toBe("Cross Check");
  });
});

describe("isolation", () => {
  it("school B cannot list, get, update or delete school A's students, guardians, consent or documents", async () => {
    const x = await asAdmin(a).create({ name: "A Only Student", sectionId: s4A, guardianName: "A Only Parent", guardianPhone: "9899900001" });
    const bSvc = asAdmin(b);
    expect((await bSvc.list()).rows.some((r) => r.id === x.id)).toBe(false);
    expect((await bSvc.list({ q: "A Only" })).total).toBe(0);
    await expect(bSvc.get(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.update(x.id, { name: "Hacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.remove(x.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new GuardianService(b.as.admin).listParents()).total).toBe(0);
    await expect(new GuardianService(b.as.admin).forStudent(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ConsentService(b.as.admin).record({ studentId: x.id, purpose: "data_processing", granted: "true" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new DocumentService(b.as.admin).upload({ studentId: x.id, kind: "other" }, png())).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PromotionService(b.as.admin).preview(s4A)).rejects.toBeInstanceOf(ValidationError);
    expect(await asAdmin(a).get(x.id)).toMatchObject({ name: "A Only Student" });
    // The same admission number is free to use in another school.
    await expect(bSvc.create({ admissionNo: x.admissionNo, name: "B Student" })).resolves.toMatchObject({ admissionNo: x.admissionNo });
  });
});

describe("student logins", () => {
  it("import also makes logins that must change their password", async () => {
    const res = await new ImportService(a.as.admin).commit("admission_no,name,dob,gender,class,section\nIMP9001,Import Login,2015-01-05,male,Class 4,A");
    expect(res).toMatchObject({ imported: 1 });
    const [st] = await withSchool(a.id, (tx) => tx.select().from(students).where(eq(students.admissionNo, "IMP9001")));
    expect(await loginOf(a.id, st!.userId!)).toMatchObject({ mustChangePassword: true });
  });

  it("slips list only never-signed-in active students of that class, with the first password, and nothing from another school", async () => {
    const one = await asAdmin(a).create({ name: "Slip One", dob: "2012-03-09", sectionId: s12A });
    const signed = await asAdmin(a).create({ name: "Slip Signed", sectionId: s12A });
    const other = await asAdmin(a).create({ name: "Slip Other Class", sectionId: s4A });
    await withSchool(a.id, (tx) => tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, signed.userId!)));

    const { slips, schoolName } = await new CredentialService(a.as.admin).slips(c12);
    const names = slips.map((x) => x.name);
    expect(names).toContain("Slip One");
    expect(names).not.toContain("Slip Signed");
    expect(names).not.toContain(other.name);
    expect(slips.find((x) => x.name === "Slip One")).toMatchObject({ loginId: one.admissionNo, password: "09032012" });
    expect(schoolName).toBe(`School ${a.slug.toUpperCase()}`);

    // producing slips is written to the audit log (getting started reads it); an empty run writes nothing
    const printed = async (id: string) => Number([...(await withConsole((tx) => tx.execute(sql`select count(*)::int as n from audit_logs where school_id = ${id} and action = 'print_slips'`)))][0]!.n);
    expect(await printed(a.id)).toBe(1);
    expect((await new CredentialService(b.as.admin).slips(c12)).slips).toEqual([]);
    expect(await printed(b.id)).toBe(0);
    await expect(new CredentialService(a.as.teacher).slips(c12)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a slip says to ask the office once an admin set a temporary password", async () => {
    const t = await asAdmin(a).create({ name: "Slip Temp", dob: "2012-05-05", sectionId: s12A });
    await withSchool(a.id, async (tx) => tx.update(users).set({ passwordHash: await Passwords.hash("temp-pass-xyz") }).where(eq(users.id, t.userId!)));
    const slip = (await new CredentialService(a.as.admin).slips(c12)).slips.find((x) => x.name === "Slip Temp");
    expect(slip).toMatchObject({ loginId: t.admissionNo, password: null });
  });

  it("reset login restores the first password, sets the flag and ends the sessions", async () => {
    const s = await asAdmin(a).create({ name: "Reset Me", dob: "2013-07-01", sectionId: s4A });
    await withSchool(a.id, async (tx) => {
      await tx.update(users).set({ passwordHash: await Passwords.hash("chosen-by-student1"), mustChangePassword: false, lastLoginAt: new Date() }).where(eq(users.id, s.userId!));
      await tx.insert(sessions).values({ schoolId: a.id, userId: s.userId!, tokenHash: `reset-${s.id}`, expiresAt: new Date(Date.now() + 86_400_000) });
    });
    expect(await new CredentialService(a.as.admin).loginStatus(s.id)).toMatchObject({ loginId: s.admissionNo, status: "active", mustChange: false });

    await new CredentialService(a.as.admin).resetLogin(s.id);
    const login = await loginOf(a.id, s.userId!);
    expect(login.mustChangePassword).toBe(true);
    expect(await Passwords.verify(login.passwordHash, "01072013")).toBe(true);
    expect(await withSchool(a.id, (tx) => tx.select().from(sessions).where(eq(sessions.userId, s.userId!)))).toHaveLength(0);

    await expect(new CredentialService(a.as.teacher).resetLogin(s.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new CredentialService(b.as.admin).resetLogin(s.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("seed", () => {
  it("fills a big school and a small one with realistic, unique data", async () => {
    const run = async (school: TestSchool, secs: { id: string; classId: string; name: string }[], grades: Record<string, number>) => {
      const state: Record<string, unknown> = {
        classes: Object.entries(grades).map(([id, grade]) => ({ id, name: `Class ${grade}`, grade })),
        sections: secs,
      };
      await seedStudents(school.as.admin, state);
      return state as { students: { id: string; name: string; userId: string; sectionId: string }[]; demoStudentLogin: string };
    };
    const greenState = await run(a, [{ id: s4A, classId: c4, name: "A" }, { id: s12A, classId: c12, name: "A" }], { [c4]: 4, [c12]: 12 });
    const perSection = (sid: string) => greenState.students.filter((s) => s.sectionId === sid).length;
    expect(perSection(s4A)).toBeGreaterThanOrEqual(10);
    expect(perSection(s4A)).toBeLessThanOrEqual(14);
    expect(greenState.students.every((s) => s.userId)).toBe(true);
    expect(greenState.demoStudentLogin).toMatch(/^GR\d{4}$/);

    const phones = (await new GuardianService(a.as.admin).listParents({ pageSize: 100 })).rows.map((r) => r.phone);
    expect(new Set(phones).size).toBe(phones.length);
    const sunState = await run(b, [{ id: (await setupAcademics(b.id)).s4A, classId: c4, name: "A" }], { [c4]: 4 });
    expect(sunState.students.length).toBeLessThanOrEqual(6);
    expect(sunState.students.length).toBeGreaterThanOrEqual(4);
  }, 120_000);
});

describe("student self-service and who sees medical notes", () => {
  const mk = (name: string, sectionId: string) => asAdmin(a).create({ name, sectionId, medicalNotes: "Peanut allergy", emergencyName: "Uncle Ram", emergencyPhone: "9877700001" });

  it("a student changes only the allowed fields, applied at once and audit-logged without the medical text", async () => {
    const me = await mk("Self Edit", s4A);
    const svc = new StudentSelfService(asStudent(me.userId!));
    const res = await svc.updateMyContact({ phone: "+91 9877700002", altPhone: "", address: "5 Park Lane", emergencyName: "Aunt Sita", emergencyPhone: "9877700003", medicalNotes: "Asthma",
      name: "Hacked", dob: "2001-01-01", sectionId: s12A, rollNo: 99, status: "left", admissionNo: "ZZ" });
    expect(res.changed).toEqual(["phone", "address", "emergencyName", "emergencyPhone", "medicalNotes"]);
    const rec = await svc.myRecord();
    expect(rec.student).toMatchObject({ name: "Self Edit", dob: null, sectionId: s4A, status: "active", phone: "9877700002", address: "5 Park Lane", medicalNotes: "Asthma", emergencyName: "Aunt Sita" });
    expect(rec.classSection).toBe("4-A");
    await expect(svc.updateMyContact({ phone: "12345" })).rejects.toMatchObject({ fieldErrors: { phone: expect.any(String) } });

    const log = await withSchool(a.id, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.entityId, me.id)));
    const entry = log.find((l) => (l.meta as { self?: boolean }).self)!;
    expect(entry.actorUserId).toBe(me.userId);
    expect(entry.meta).toMatchObject({ fields: ["phone", "address", "emergencyName", "emergencyPhone", "medicalNotes"] });
    expect(JSON.stringify(entry)).not.toContain("Asthma");
  });

  it("only a student login may use it, and a student cannot read another student's record", async () => {
    await expect(new StudentSelfService(a.as.admin).updateMyContact({ phone: "9877700009" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StudentSelfService(a.as.teacher).myRecord()).rejects.toBeInstanceOf(ForbiddenError);
    const one = await mk("Peek One", s4A), two = await mk("Peek Two", s4A);
    await expect(new StudentService(asStudent(one.userId!)).get(two.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new StudentService(asStudent(one.userId!)).medical(two.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a teacher sees medical notes for their own section only", async () => {
    const mine = await mk("Mine Kid", s4A), other = await mk("Other Kid", s12A);
    await withSchool(a.id, (tx) => tx.update(sections).set({ classTeacherId: a.users.teacher }).where(eq(sections.id, s4A)));
    const t = new StudentService(a.as.teacher);
    expect(await t.medical(mine.id)).toMatchObject({ medicalNotes: "Peanut allergy", emergencyPhone: "9877700001" });
    await expect(t.medical(other.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await t.get(mine.id)).toMatchObject({ medicalNotes: "Peanut allergy" });
    expect(await t.get(other.id)).toMatchObject({ name: "Other Kid", medicalNotes: null, emergencyName: null, emergencyPhone: null });
    expect((await t.overview(other.id)).student.medicalNotes).toBeNull();
    expect((await t.list({ q: "Other Kid" })).rows[0]!.medicalNotes).toBeNull();
    // Office staff keep the full view.
    expect((await new StudentService(a.as.accountant).get(other.id)).medicalNotes).toBe("Peanut allergy");
    await withSchool(a.id, (tx) => tx.update(sections).set({ classTeacherId: null }).where(eq(sections.id, s4A)));
  });

  it("school B cannot reach A's student through myRecord, and each school sees its own", async () => {
    const mineA = await mk("Iso A", s4A);
    const bStudent = await new StudentService(b.as.admin).create({ name: "Iso B" });
    expect((await new StudentSelfService(asStudent(mineA.userId!)).myRecord()).student.name).toBe("Iso A");
    expect((await new StudentSelfService({ ...b.as.student, userId: bStudent.userId! }).myRecord()).student.name).toBe("Iso B");
    await expect(new StudentSelfService({ ...b.as.student, userId: mineA.userId! }).myRecord()).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("xlsx and csv import", () => {
  const xlsx = new Uint8Array(readFileSync(new URL("./fixtures/students-import.xlsx", import.meta.url)));
  const csv = [
    "admission_no,name,dob,gender,class,section,guardian_name,guardian_phone,guardian_relation,phone,medical_notes,ignored_extra",
    ",Xl Good One,2015-01-05,female,Class 4,A,Xl Parent,9890000011,mother,9890000012,Asthma,zz",
    ",Xl Good Two,2014-02-02,male,Class 12,A,,,,,,",
    ",Xl Bad Phone,2015-01-05,male,Class 4,A,,,,12345,,",
  ].join("\n");
  const count = () => asAdmin(a).list().then((p) => p.total);

  it("an .xlsx and the same rows as .csv give the same report; a bad row names its line and column and nothing is written", async () => {
    const before = await count();
    const svc = new ImportService(a.as.admin);
    const fromX = await svc.dryRun({ name: "students.xlsx", bytes: xlsx });
    const fromC = await svc.dryRun({ name: "students.csv", bytes: new TextEncoder().encode(csv) });
    expect(fromX).toEqual(fromC);
    expect(fromX).toMatchObject({ total: 3, valid: 2, failed: 1 });
    expect(fromX.rows[2]).toMatchObject({ line: 4 });
    expect(fromX.rows[2]!.errors[0]).toMatch(/^phone:/);
    await expect(svc.commit({ name: "students.xlsx", bytes: xlsx })).rejects.toMatchObject({ fieldErrors: { file: expect.stringContaining("1 of 3 rows") } });
    expect(await count()).toBe(before);
  });

  it("commits the new columns, ignores unknown ones, and names the classes for login slips", async () => {
    const good = csv.split("\n").slice(0, 3).join("\n");
    const res = await new ImportService(a.as.admin).commit({ name: "ok.csv", bytes: new TextEncoder().encode(good) });
    expect(res).toMatchObject({ imported: 2, slipClasses: expect.arrayContaining([{ id: c4, name: "Class 4" }, { id: c12, name: "Class 12" }]) });
    const [row] = (await asAdmin(a).list({ q: "Xl Good One" })).rows;
    expect(row).toMatchObject({ phone: "9890000012", medicalNotes: "Asthma" });
  });

  it("a missing required column is a clear error and the template has the new columns", async () => {
    await expect(new ImportService(a.as.admin).dryRun({ name: "x.csv", bytes: new TextEncoder().encode("name,class\nA,4") })).rejects.toMatchObject({ fieldErrors: { file: expect.stringContaining("section") } });
    expect(ImportService.templateCsv().split("\n")[0]).toContain("medical_notes");
  });
});
