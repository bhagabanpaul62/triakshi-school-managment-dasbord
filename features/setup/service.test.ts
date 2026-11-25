import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@smw/db";
import { ConflictError, ForbiddenError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import { SchoolProfileService } from "@smw/feature-settings/service";
import { SetupService } from "./service";

const FEATURES = ["setup", "settings", "academics", "students", "staff", "announcements", "events", "website"];
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
    expect(p).toMatchObject({ doneCount: 0, total: 7, ready: false, completedAt: null, next: "year" });
    expect(p.steps.every((s) => !s.done)).toBe(true);
    expect(p.facts).toMatchObject({ classes: 0, sections: 0, students: 0, year: null });
  });

  it("leaves out the steps whose feature the school does not have", async () => {
    const p = await new SetupService({ ...b.as.admin, features: new Set(["setup", "settings", "academics"]) }).progress();
    expect(p.available).toEqual(["profile", "year", "classes", "subjects"]);
    expect(p.total).toBe(4);
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
      profile: false, year: true, classes: true, subjects: true, students: false, staff: true, website: true,
    });
    expect(p).toMatchObject({ doneCount: 5, total: 7, next: "profile" });
    expect(p.steps.find((x) => x.key === "classes")?.summary).toBe("3 classes, 5 sections");
    expect(p.steps.find((x) => x.key === "staff")?.summary).toBe("1 teacher");
  });

  it("isolation: school B sees none of school A's setup", async () => {
    const p = await new SetupService(b.as.admin).progress();
    expect(p.facts).toMatchObject({ classes: 0, sections: 0, subjects: 0, teachers: 0, year: null });
    expect(p.steps.some((s) => s.done)).toBe(false);
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
