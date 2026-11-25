import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, users, withSchool } from "@smw/db";
import { MemoryStorage, useServices } from "@smw/integrations";
import { build, type Fx } from "./fixtures";
import { CircularService, NoticeService, ReportService } from "./service";
import seed from "./seed";

let fx: Fx;
beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  fx = await build("sd");
  // four more families in 5A so the demo answers have people to come from
  await withSchool(fx.school.id, async (tx) => {
    for (const n of ["Dev", "Esha", "Farid", "Gita"]) {
      const [u] = await tx.insert(users).values({ schoolId: fx.school.id, role: "student", loginId: `l-${n}`, name: `Login ${n}`, email: `${n}@x.test` }).returning();
      await tx.execute(sql`insert into students (id, school_id, admission_no, name, class_id, section_id, status, user_id) values (gen_random_uuid(), ${fx.school.id}::uuid, ${`S-${n}`}, ${n}, ${fx.ids.c5}::uuid, ${fx.ids.s5a}::uuid, 'active', ${u!.id}::uuid)`);
    }
  });
});
afterAll(closeDb);

describe("the demo seed", () => {
  it("makes every state and every kind of answer, and the numbers add up", async () => {
    const kids = await withSchool(fx.school.id, async (tx) => [...(await tx.execute(sql`select id, name, section_id as "sectionId", user_id as "userId" from students where status = 'active'`))]);
    await seed(fx.school.as.admin, { sections: [{ id: fx.ids.s5a, classId: fx.ids.c5 }, { id: fx.ids.s5b, classId: fx.ids.c5 }], students: kids, teachers: [{ userId: fx.school.users.teacher, name: "Teacher" }] });
    const admin = new NoticeService(fx.school.as.admin);
    const counts = await admin.counts();
    expect(counts).toMatchObject({ waiting: 1, scheduled: 1, drafts: 1 });
    expect(counts.live).toBeGreaterThanOrEqual(8);
    const archive = (await admin.list({ tab: "archive" })).rows;
    expect(archive.map((r) => r.state).sort()).toEqual(["expired", "withdrawn"]);
    const live = (await admin.list({ tab: "live", pageSize: 50 })).rows;
    expect(new Set(live.map((r) => r.responseKind))).toEqual(new Set(["none", "ack", "consent", "poll", "form"]));
    expect(live.find((r) => r.title.startsWith("Half-yearly"))).toMatchObject({ version: 2, number: "CIR/2026-27/001" });
    const trip = live.find((r) => r.title.startsWith("Trip"))!;
    const f = await new ReportService(fx.school.as.admin).funnel(trip.id);
    expect(f).toMatchObject({ answered: 4, yes: 3, no: 1, onPaper: 1 });
    expect(f.yes + f.no + f.other + f.notAnswered).toBe(f.recipients);
    const slot = live.find((r) => r.title.startsWith("Choose a parent"))!;
    expect((await new ReportService(fx.school.as.admin).funnel(slot.id)).late).toBeGreaterThan(0);
    const register = await new CircularService(fx.school.as.admin).register();
    expect(register.rows.map((r) => [r.number, r.state])).toEqual([["CIR/2026-27/001", "published"], ["CIR/2026-27/002", "withdrawn"]]);
  });
});
