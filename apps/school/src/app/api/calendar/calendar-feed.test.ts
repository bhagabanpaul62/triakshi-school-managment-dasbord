// A family that left no longer gets the school's calendar on their phone; everyone else does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, withSchool } from "@smw/db";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import academics from "@smw/feature-academics/feature";
import students from "@smw/feature-students/feature";
import events from "@smw/feature-events/feature";
import { CalendarFeedService } from "@smw/feature-events/feed";
import { GET } from "./[token]/route";

let a: TestSchool, b: TestSchool;
const get = (s: TestSchool, token: string) => GET(new Request(`http://${s.slug}.localhost/api/calendar/${token}.ics`), { params: Promise.resolve({ token: `${token}.ics` }) });
const ist = (daysAgo: number) => new Date(Date.now() + 330 * 60_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);
const setRow = (s: TestSchool, status: string, leftOn: string | null) => withSchool(s.id, async (tx) => {
  await tx.execute(sql`delete from students where user_id = ${s.users.student}`);
  if (status) await tx.execute(sql`insert into students (id, school_id, admission_no, name, user_id, status, left_on) values (gen_random_uuid(), ${s.id}, 'ADM-CF', 'Kid', ${s.users.student}, ${status}, ${leftOn}::date)`);
});

beforeAll(async () => {
  await registerFeatures([academics, students, events]);
  ({ a, b } = await createSchoolPair(["academics", "students", "events"], "calfeed"));
});
afterAll(closeDb);

describe("personal calendar link", () => {
  it("works for staff, for a student with no row and for an active student; stops for a left or alumni student, and is not found like any wrong link", async () => {
    const link = async (s: TestSchool, role: "student" | "teacher") => (await new CalendarFeedService({ ...s.as[role], features: new Set(["events"]) }).reset()).token;
    const teacher = await link(a, "teacher"), kid = await link(a, "student");
    expect((await get(a, teacher)).status).toBe(200);
    await setRow(a, "", null);
    expect((await get(a, kid)).status).toBe(200);
    await setRow(a, "active", null);
    expect((await get(a, kid)).status).toBe(200);
    for (const [status, leftOn] of [["left", ist(5)], ["alumni", ist(5)], ["left", ist(120)], ["left", null]] as const) {
      await setRow(a, status, leftOn);
      const r = await get(a, kid);
      expect(r.status, `${status} ${leftOn}`).toBe(404);
      expect(await r.text()).toBe("Not found");
    }
    expect((await get(a, "A".repeat(22))).status).toBe(404);
  });

  it("school isolation: school A's left student does not stop school B's link", async () => {
    await setRow(a, "left", ist(5));
    const tok = (await new CalendarFeedService({ ...b.as.student, features: new Set(["events"]) }).reset()).token;
    expect((await get(b, tok)).status).toBe(200);
    expect((await get(a, tok)).status).toBe(404);
  });
});
