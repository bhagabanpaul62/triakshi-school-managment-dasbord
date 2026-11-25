import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@smw/db";
import { ConflictError, ForbiddenError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import { SchoolProfileService } from "@smw/feature-settings/service";
import { SetupService } from "./service";

const FEATURES = ["setup", "settings", "academics", "students", "staff", "announcements", "events", "website", "support"];
let a: TestSchool, b: TestSchool;
const mail = new MemoryEmailSender();

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(FEATURES));
  useServices({ storage: new MemoryStorage(), email: mail });
});
afterAll(closeDb);

describe("SetupService.progress", () => {
  it("an empty school has nothing done and starts at the academic year", async () => {
    const p = await new SetupService(b.as.admin).progress();
    // The fixture school already has an admin and an accountant, so "team" is the one step that is done.
    expect(p).toMatchObject({ doneCount: 1, total: 9, ready: false, completedAt: null, next: "year" });
    expect(p.steps.filter((s) => s.done).map((s) => s.key)).toEqual(["team"]);
    expect(p.facts).toMatchObject({ classes: 0, sections: 0, students: 0, year: null });
  });

  it("leaves out the steps whose feature the school does not have", async () => {
    const p = await new SetupService({ ...b.as.admin, features: new Set(["setup", "settings", "academics"]) }).progress();
    expect(p.available).toEqual(["profile", "year", "classes", "subjects", "team"]);
    expect(p.total).toBe(5);
  });

  it("follows the data: year, classes, subjects, teachers and the website each tick their step", async () => {
    const svc = new SetupService(a.as.admin);

    const y = await svc.saveYear({ name: "2026-27", terms: "2" });
    expect(y.year).toMatchObject({ startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true });
    expect(y.termsAdded).toBe(2);
    expect((await svc.saveYear({ name: "2026-27", terms: "3" })).termsAdded).toBe(0); // a year that has terms keeps them
    expect(await svc.progress()).toMatchObject({ ready: false, next: "classes", facts: { year: { name: "2026-27" } } });

    await expect(new SetupService(b.as.admin).saveClasses({ picks: [{ grade: 1, sections: 1 }] })).rejects.toBeInstanceOf(ConflictError);
    const c = await svc.saveClasses({ picks: [{ grade: 1, sections: 2 }, { grade: 6, sections: 1 }, { grade: 9, sections: 1 }] });
    expect(c).toEqual({ classes: 3, sections: 4 });
    expect(await svc.saveClasses({ picks: [{ grade: 1, sections: 3 }] })).toEqual({ classes: 0, sections: 1 }); // only the missing section C
    const state = await svc.classesState();
    expect(state.existing).toEqual({ 1: 3, 6: 1, 9: 1 });

    const s = await svc.saveSubjects({
      board: "CBSE",
      picks: [
        { name: "English", bands: ["pre", "primary", "middle", "secondary"] },
        { name: "EVS", bands: ["pre", "primary"] },
        { name: "Science", bands: ["primary", "middle", "secondary"] },
      ],
    });
    expect(s).toEqual({ subjectsAdded: 3, assigned: 7 });
    expect(await svc.saveSubjects({ board: "CBSE", picks: [{ name: "English", bands: ["primary"] }] })).toEqual({ subjectsAdded: 0, assigned: 0 });
    const sub = await svc.subjectsState();
    expect(sub.bandCounts).toEqual({ pre: 0, primary: 1, middle: 1, secondary: 1 });
    expect(sub.assigned.English).toEqual(["primary", "middle", "secondary"]);
    expect(sub.assigned.EVS).toEqual(["primary"]);
    await expect(svc.saveSubjects({ board: "CBSE", picks: [{ name: "Quantum Basket Weaving", bands: ["primary"] }] })).rejects.toBeInstanceOf(ValidationError);

    const t = await svc.inviteTeachers({ rows: [
      { name: "Meera Iyer", email: "meera@gv.test" },
      { name: "No Email", email: "" },
      { name: "", email: "" },
      { name: "Meera Again", email: "MEERA@gv.test" },
    ] });
    expect(t.added.map((x) => x.email)).toEqual(["meera@gv.test"]);
    expect(t.failed.map((x) => x.line)).toEqual([2, 4]);
    expect(mail.sent.some((m) => m.to === "meera@gv.test")).toBe(true);
    await expect(svc.inviteTeachers({ rows: [{ name: "", email: "" }] })).rejects.toBeInstanceOf(ValidationError);

    expect(await svc.publishWebsite({ template: "modern", preset: "forest" })).toMatchObject({ themeApplied: true });

    const p = await svc.progress();
    expect(p.ready).toBe(true);
    expect(Object.fromEntries(p.steps.map((x) => [x.key, x.done]))).toEqual({
      profile: false, year: true, classes: true, subjects: true, staff: true, students: false, classteachers: false, website: true, team: true,
    });
    expect(p).toMatchObject({ doneCount: 6, total: 9, next: "profile" });
    expect(p.steps.find((x) => x.key === "classes")?.summary).toBe("3 classes, 5 sections");
    expect(p.steps.find((x) => x.key === "staff")?.summary).toBe("1 teacher");
  });

  it("isolation: school B sees none of school A's setup", async () => {
    const p = await new SetupService(b.as.admin).progress();
    expect(p.facts).toMatchObject({ classes: 0, sections: 0, subjects: 0, teachers: 0, year: null });
    expect(p.steps.filter((s) => s.done).map((s) => s.key)).toEqual(["team"]);
  });
});

describe("SetupService.saveProfile", () => {
  it("saves the details and keeps the GSTIN and timezone it did not ask for", async () => {
    await new SchoolProfileService(a.as.admin).update({ name: "Green Valley", gstin: "27ABCDE1234F1Z5", timezone: "Asia/Kolkata", academicYearStartMonth: 4 });
    const svc = new SetupService(a.as.admin);
    await svc.saveProfile({ name: "Green Valley Public School", board: "CBSE", state: "Maharashtra", city: "Pune", phone: "9876543210" });
    expect(await svc.profile()).toMatchObject({ name: "Green Valley Public School", board: "CBSE", city: "Pune", gstin: "27ABCDE1234F1Z5", timezone: "Asia/Kolkata" });
    expect((await svc.progress()).steps.find((s) => s.key === "profile")).toMatchObject({ done: true, summary: "CBSE · Pune, Maharashtra" });
    expect((await svc.subjectsState()).board).toBe("CBSE");
  });
});

describe("SetupService.markComplete", () => {
  it("only an admin can finish setup", async () => {
    await expect(new SetupService(a.as.teacher).markComplete()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SetupService(a.as.parent).progress()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SetupService({ ...a.as.admin, readOnly: true }).markComplete()).rejects.toThrow();
  });

  it("needs the year and classes first", async () => {
    await expect(new SetupService(b.as.admin).markComplete()).rejects.toBeInstanceOf(ConflictError);
    expect((await new SetupService(b.as.admin).progress()).completedAt).toBeNull();
  });

  it("stamps the school once and then leaves the date alone", async () => {
    const svc = new SetupService(a.as.admin);
    const first = await svc.markComplete();
    expect((await svc.progress()).completedAt).toEqual(first.completedAt);
    expect((await svc.markComplete()).completedAt).toEqual(first.completedAt);
    expect((await new SetupService(b.as.admin).progress()).completedAt).toBeNull();
  });
});

describe("SetupService.communication", () => {
  it("an empty school has four steps to do, and a school without notices has three", async () => {
    const all = new Set([...FEATURES, "notifications", "settings"]);
    const steps = await new SetupService({ ...b.as.admin, features: all }).communication();
    expect(steps.map((s) => [s.key, s.done])).toEqual([["email", false], ["quiet", false], ["lead", false], ["notice", false]]);
    const few = await new SetupService({ ...b.as.admin, features: new Set(["setup", "settings", "notifications"]) }).communication();
    expect(few.map((s) => s.key)).toEqual(["email", "quiet", "lead"]);
  });
});

describe("wizard: class teachers, team, staff sheet, students by hand", () => {
  it("one select per section, saved through the section service; only changes are written; school B cannot be reached", async () => {
    const svc = new SetupService(a.as.admin);
    const state = await svc.classTeacherState();
    expect(state.sections).toHaveLength(5);
    expect(state.teachers.map((t) => t.id)).toContain(a.users.teacher);
    expect(state.sections.every((s) => s.teacherId === null)).toBe(true);
    expect((await svc.saveClassTeachers({ picks: state.sections.map((s) => ({ sectionId: s.id, teacherId: a.users.teacher })) })).changed).toBe(5);
    expect((await svc.saveClassTeachers({ picks: state.sections.map((s) => ({ sectionId: s.id, teacherId: a.users.teacher })) })).changed).toBe(0);
    const p = await svc.progress();
    expect(p.steps.find((x) => x.key === "classteachers")).toMatchObject({ done: true, summary: "5 sections with a class teacher" });
    // a clear writes only that section
    expect((await svc.saveClassTeachers({ picks: [{ sectionId: state.sections[0]!.id, teacherId: "" }] })).changed).toBe(1);
    expect((await svc.progress()).steps.find((x) => x.key === "classteachers")?.done).toBe(false);
    // a student login is not a teacher; another school's section is not found
    // a student login is not a teacher: that row says why, and the good row beside it is still saved
    const mixed = await svc.saveClassTeachers({ picks: [
      { sectionId: state.sections[0]!.id, teacherId: a.users.student }, { sectionId: state.sections[1]!.id, teacherId: "" },
    ] });
    expect(mixed).toEqual({ changed: 1, failed: [{ sectionId: state.sections[0]!.id, error: "Pick a teacher from your staff" }] });
    expect((await svc.classTeacherState()).sections.find((x) => x.id === state.sections[1]!.id)?.teacherId).toBeNull();
    await svc.saveClassTeachers({ picks: [{ sectionId: state.sections[1]!.id, teacherId: a.users.teacher }] });
    // another school's section is not found, whoever asks
    const sectionOfA = state.sections[1]!.id;
    await expect(new SetupService(b.as.admin).saveClassTeachers({ picks: [{ sectionId: sectionOfA, teacherId: b.users.teacher }] })).resolves.toMatchObject({ changed: 0, failed: [{ sectionId: sectionOfA }] });
    await expect(new SetupService(a.as.teacher).saveClassTeachers({ picks: [{ sectionId: sectionOfA, teacherId: "" }] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a second admin or office login goes through the staff service with an invite; teachers and bad roles are refused", async () => {
    const svc = new SetupService(a.as.admin);
    const r = await svc.addTeam({ name: "Second Admin", email: "second@gv.test", role: "admin" });
    expect(r).toMatchObject({ email: "second@gv.test", emailed: true });
    expect(mail.sent.some((m) => m.to === "second@gv.test")).toBe(true);
    const team = await svc.team();
    expect(team.map((t) => t.email)).toContain("second@gv.test");
    expect(team.find((t) => t.email === "second@gv.test")).toMatchObject({ role: "admin", state: "invited" });
    await expect(svc.addTeam({ name: "Nobody", email: "n@gv.test", role: "teacher" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addTeam({ name: "Same Again", email: "second@gv.test", role: "accountant" })).rejects.toMatchObject({ fieldErrors: { email: "Someone already signs in with this email" } });
    await expect(new SetupService(a.as.teacher).addTeam({ name: "X Y", email: "xy@gv.test", role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new SetupService(b.as.admin).team()).map((t) => t.email)).not.toContain("second@gv.test");
  });

  it("staff from a pasted sheet: checked first, saved all together, and a bad row stops it", async () => {
    const svc = new SetupService(a.as.admin);
    const bytes = (t: string) => ({ name: "pasted.csv", bytes: new TextEncoder().encode(t) });
    const sheet = "name\temail\tphone\trole\nAsha Rao\tasha@gv.test\t\tTeacher\nBina Das\tbina@gv.test\t\tAccountant";
    expect(await svc.checkStaffSheet(bytes(sheet))).toMatchObject({ total: 2, valid: 2, failed: 0 });
    const done = await svc.importStaffSheet(bytes(sheet));
    expect(done.imported).toBe(2);
    expect(mail.sent.some((m) => m.to === "asha@gv.test")).toBe(true);
    expect(await svc.checkStaffSheet(bytes("name\temail\trole\nAsha Rao\tasha@gv.test\tTeacher"))).toMatchObject({ failed: 1 }); // already there
    await expect(svc.importStaffSheet(bytes("name\temail\trole\nAsha Rao\tasha@gv.test\tTeacher"))).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.checkStaffSheet(bytes("email\nx@gv.test"))).rejects.toBeInstanceOf(ValidationError); // no name column
    await expect(new SetupService(a.as.teacher).importStaffSheet(bytes(sheet))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("five students by hand: the good ones are saved, a bad row stays with its reason", async () => {
    const svc = new SetupService(a.as.admin);
    const secs = await svc.sectionOptions();
    expect(secs.length).toBe(5);
    const before = (await svc.progress()).facts.students;
    const r = await svc.addStudents({ rows: [
      { name: "Aarav Mehta", sectionId: secs[0]!.id, guardianName: "Rohit Mehta", guardianPhone: "9876543210" },
      { name: "Diya Nair", sectionId: secs[1]!.id, guardianName: "", guardianPhone: "" },
      { name: "No Class", sectionId: "", guardianName: "", guardianPhone: "" },
      { name: "", sectionId: "", guardianName: "", guardianPhone: "" },
    ] });
    expect(r.added).toBe(2);
    expect(r.failed).toEqual([{ line: 3, name: "No Class", error: "Pick the class and section" }]);
    expect((await svc.progress()).facts.students).toBe(before + 2);
    await expect(svc.addStudents({ rows: [{ name: "", sectionId: "", guardianName: "", guardianPhone: "" }] })).rejects.toBeInstanceOf(ValidationError);
    const cross = await new SetupService(b.as.admin).addStudents({ rows: [{ name: "Cross School", sectionId: secs[0]!.id, guardianName: "", guardianPhone: "" }] });
    expect(cross).toMatchObject({ added: 0, failed: [{ error: "Pick the class and section" }] }); // school A's section is not school B's
    await expect(new SetupService(a.as.teacher).addStudents({ rows: [{ name: "T", sectionId: secs[0]!.id, guardianName: "", guardianPhone: "" }] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("do later is remembered for the school: the step stays, but it is no longer the next one; required steps cannot be skipped", async () => {
    const svc = new SetupService(b.as.admin);
    await expect(svc.skipStep({ step: "year" })).rejects.toBeInstanceOf(ConflictError);
    await svc.saveYear({ name: "2026-27", terms: "0" });
    await svc.saveClasses({ picks: [{ grade: 1, sections: 1 }] });
    expect((await svc.progress()).next).toBe("profile");
    await svc.skipStep({ step: "profile" });
    await svc.skipStep({ step: "profile" }); // twice is fine (two admins)
    const p = await svc.progress();
    expect(p.steps.find((s) => s.key === "profile")).toMatchObject({ done: false, skipped: true });
    expect(p.next).toBe("subjects");
    expect((await new SetupService(a.as.admin).progress()).facts.skipped).toEqual([]); // school A is untouched
    await expect(new SetupService(a.as.teacher).skipStep({ step: "subjects" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("two admins saving the same classes at once do not collide", async () => {
    const svc = new SetupService(b.as.admin);
    const one = () => svc.saveClasses({ picks: [{ grade: 2, sections: 2 }, { grade: 3, sections: 2 }] });
    const results = await Promise.allSettled([one(), one()]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const state = await svc.classesState();
    expect(state.existing).toMatchObject({ 1: 1, 2: 2, 3: 2 });
  });

  it("Ask us opens an onboarding ticket for the step, raised by the person asking", async () => {
    const svc = new SetupService(b.as.admin);
    const r = await svc.askUs({ step: "students", body: "How do I get the class and section names right?" });
    expect(r.ticketId).toMatch(/^[0-9a-f-]{36}$/);
    const { SupportService } = await import("@smw/feature-support/service");
    const t = (await new SupportService(b.as.admin).thread(r.ticketId)).ticket;
    expect(t).toMatchObject({ subject: "Setup help: Students", category: "onboarding", createdByUserId: b.users.admin, context: { page: "/app/setup/students" } });
    await expect(svc.askUs({ step: "students", body: "hi" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new SetupService(a.as.teacher).askUs({ step: "students", body: "Please help me here" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SupportService(a.as.admin).thread(r.ticketId)).rejects.toThrow(); // school A cannot see B's ticket
  });
});

describe("wizard: team counts people who are in, not people who were only invited", () => {
  it("an invited admin is 'waiting' in words and does not make the step done until they sign in", async () => {
    const c = await createTestSchool("ct", FEATURES);
    const svc = new SetupService(c.as.admin);
    const { withConsole, sql } = await import("@smw/db");
    await withConsole((tx) => tx.execute(sql`update users set status = 'disabled' where school_id = ${c.id} and role = 'accountant'`));
    expect((await svc.progress()).steps.find((s) => s.key === "team")).toMatchObject({ done: false, summary: null });
    await svc.addTeam({ name: "Office Two", email: "office2@ct.test", role: "accountant" });
    expect((await svc.progress()).steps.find((s) => s.key === "team")).toMatchObject({ done: false, summary: "1 person invited, waiting for them to sign in" });
    await withConsole((tx) => tx.execute(sql`update users set status = 'active' where school_id = ${c.id} and email = 'office2@ct.test'`));
    expect((await svc.progress()).steps.find((s) => s.key === "team")).toMatchObject({ done: true, summary: "2 logins for the office" });
  });
});

describe("wizard: the approval gate and two admins at once", () => {
  it("a school the platform has not approved (or has rejected) cannot save any step", async () => {
    const c = await createTestSchool("cg", FEATURES);
    const { withConsole, sql } = await import("@smw/db");
    const svc = new SetupService(c.as.admin);
    for (const status of ["pending", "rejected"]) {
      await withConsole((tx) => tx.execute(sql`update schools set status = ${status} where id = ${c.id}`));
      await expect(svc.saveYear({ name: "2026-27" })).rejects.toMatchObject({ message: "Your school has not been approved yet." });
      await expect(svc.skipStep({ step: "profile" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc.markComplete()).rejects.toBeInstanceOf(ForbiddenError);
    }
    await withConsole((tx) => tx.execute(sql`update schools set status = 'active' where id = ${c.id}`));
    await expect(svc.saveYear({ name: "2026-27" })).resolves.toBeTruthy();
  });

  it("two admins saving the year, the subjects or the profile at the same moment both succeed and nothing doubles", async () => {
    const c = await createTestSchool("cr", FEATURES);
    const one = new SetupService(c.as.admin), two = new SetupService({ ...c.as.admin, userId: c.users.admin });
    const years = await Promise.allSettled([one.saveYear({ name: "2026-27", terms: "2" }), two.saveYear({ name: "2026-27", terms: "2" })]);
    expect(years.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await one.yearState()).termCount).toBe(2);
    await one.saveClasses({ picks: [{ grade: 1, sections: 1 }] });
    const picks = [{ name: "English", bands: ["primary"] }];
    const subjects = await Promise.allSettled([one.saveSubjects({ board: "CBSE", picks }), two.saveSubjects({ board: "CBSE", picks })]);
    expect(subjects.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await one.progress()).facts).toMatchObject({ subjects: 1, assignments: 1 });
    const profile = { name: "Rose School", board: "CBSE", state: "Kerala", city: "Kochi" };
    const profiles = await Promise.allSettled([one.saveProfile(profile), two.saveProfile({ ...profile, city: "Thrissur" })]);
    expect(profiles.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
  });
});
