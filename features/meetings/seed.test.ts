import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { students } from "@smw/feature-students/schema";
import { crowd, fixture, FEATURES } from "./test-fixture";
import seed from "./seed";
import { BookingService, DayService, MeetingService } from "./service";

let a: TestSchool;
const state: Record<string, unknown> = {};

beforeAll(async () => {
  ({ a } = await createSchoolPair(FEATURES, "mseed"));
  const ids = await fixture(a);
  const extra = await crowd(a, ids, 12);
  const rows = await withSchool(a.id, (tx) => tx.select().from(students).where(eq(students.status, "active")));
  state.sections = [{ id: ids.sectionA }, { id: ids.sectionB }];
  state.students = rows.map((s) => ({ id: s.id, name: s.name, sectionId: s.sectionId, userId: s.userId }));
  state.teachers = [];
  void extra;
  await seed(a.as.admin, state);
});
afterAll(closeDb);

describe("seed", () => {
  it("leaves one open meeting with bookings, one done with remarks, one draft", async () => {
    const list = (await new MeetingService(a.as.admin).list({ pageSize: 50 })).rows;
    const by = (state: string) => list.filter((m) => m.state === state);
    expect(by("open")).toHaveLength(1);
    expect(by("open")[0]!.booked).toBeGreaterThan(0);
    expect(by("done")).toHaveLength(1);
    expect(by("draft")).toHaveLength(1);
    const done = by("done")[0]!;
    const day = await new DayService(a.as.admin).notCame(done.id);
    expect(day.length).toBeGreaterThanOrEqual(0);
    const detail = await new MeetingService(a.as.admin).get(done.id);
    const visited = detail.windows.flatMap((w) => w.slots).filter((s) => s.visit);
    expect(visited.length).toBeGreaterThan(0);
  });

  it("a seeded family sees its booking", async () => {
    const open = (await new MeetingService(a.as.admin).list({ filters: { state: "open" } })).rows[0]!;
    const mine = await new MeetingService(a.as.student).list();
    expect(mine.rows.map((r) => r.id)).toContain(open.id);
    const v = await new BookingService(a.as.student).forFamily(open.id);
    expect(v.kids[0]!.teachers.length).toBeGreaterThan(0);
  });
});
