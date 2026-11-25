import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, users, uuidv7, withSchool } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { classes } from "@smw/feature-academics/schema";
import { AcademicsFixture } from "./test-fixture";
import { PeriodService, TimetableService, cellKey } from "./service";

let a: TestSchool, fa: AcademicsFixture;
let slotId: string;
const logins: Record<string, string> = {};
const WEDNESDAY = new Date("2026-11-25T04:30:00Z");
const asLogin = (userId: string): Ctx => ({ ...a.as.student, userId });
const FEATURES = ["academics", "students", "attendance", "notifications", "timetable"];

beforeAll(async () => {
  ({ a } = await createSchoolPair(FEATURES, "xj"));
  fa = await AcademicsFixture.create(a);
  await new PeriodService(a.as.admin).applyPreset();
  const period = (await new PeriodService(a.as.admin).all()).find((p) => !p.isBreak)!;
  const svc = new TimetableService(a.as.admin);
  await svc.setSlot({ sectionId: fa.s2, dayOfWeek: 3, periodId: period.id, subjectId: fa.maths, teacherId: fa.t1 });
  slotId = (await svc.sectionGrid(fa.s2)).cells[cellKey(3, period.id)]!.slotId!;
  await withSchool(a.id, async (tx) => {
    const [cls] = await tx.select({ id: classes.id }).from(classes).limit(1);
    const login = async (n: string) => (await tx.insert(users).values({ schoolId: a.id, role: "student", loginId: `${n}-${a.slug}`, name: n }).returning())[0]!.id;
    const kid = async (adm: string, name: string, roll: number | null, status: string, userId: string) => {
      const inSection = status !== "joining";
      await tx.execute(sql`insert into students (id, school_id, admission_no, name, class_id, section_id, joins_section_id, roll_no, status, user_id)
        values (${uuidv7()}, ${a.id}, ${adm}, ${name}, ${cls!.id}, ${inSection ? fa.s2 : null}, ${inSection ? null : fa.s2}, ${roll}, ${status}, ${userId})`);
    };
    logins.active = await login("active"); logins.left = await login("left"); logins.joining = await login("join");
    await kid("X1", "Asha Active", 1, "active", logins.active);
    await kid("X2", "Laksh Left", 2, "left", logins.left);
    await kid("X3", "Jiya Joining", null, "joining", logins.joining);
  });
});
afterAll(closeDb);

describe("joining and left children", () => {
  it("are on no period roster", async () => {
    expect((await new TimetableService(a.as.admin).slotStudents({ slotId })).map((s) => s.name)).toEqual(["Asha Active"]);
  });

  it("see no timetable as a student login, while an active child sees the period", async () => {
    const rows = async (userId: string) => (await new TimetableService(asLogin(userId)).today(WEDNESDAY)).rows;
    expect((await rows(logins.active!)).length).toBeGreaterThan(0);
    expect(await rows(logins.left!)).toHaveLength(0);
    expect(await rows(logins.joining!)).toHaveLength(0);
  });
});
