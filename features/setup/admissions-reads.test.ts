import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, users, uuidv7, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { SetupTaskService } from "./task-service";
import { SetupService } from "./service";

const FEATURES = ["setup", "settings", "academics", "students"];
let a: TestSchool;

beforeAll(async () => {
  ({ a } = await createSchoolPair(FEATURES, "xj"));
  await withSchool(a.id, async (tx) => {
    const kid = async (n: string, status: "active" | "left" | "joining", loggedIn: boolean) => {
      const [u] = await tx.insert(users).values({ schoolId: a.id, role: "student", loginId: `${n}-${a.slug}`, name: n, status: status === "joining" ? "disabled" : "active", lastLoginAt: loggedIn ? new Date() : null }).returning();
      await tx.execute(sql`insert into students (id, school_id, admission_no, name, status, user_id) values (${uuidv7()}, ${a.id}, ${"S" + n}, ${n}, ${status}, ${u!.id})`);
    };
    await kid("asha", "active", true);
    // two children who left keep a working login for a while and never signed in again
    await kid("laksh", "left", false); await kid("leela", "left", false);
    await kid("jiya", "joining", false);
  });
});
afterAll(closeDb);

describe("joining and left children", () => {
  it("do not count against 'half of the families signed in', and are not students of the setup count", async () => {
    const ctx = { ...a.as.admin, features: new Set(FEATURES) };
    const task = (await new SetupTaskService(ctx).progress()).groups.flatMap((g) => g.tasks).find((t) => t.key === "people.families");
    expect(task?.state).toBe("done");
    expect((await new SetupService(ctx).progress()).facts.students).toBe(1);
  });
});
