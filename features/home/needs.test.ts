import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import type { Ctx } from "@smw/feature-kit";
import { buildSchoolData } from "@smw/feature-attendance/test-fixture";
import { HomeService } from "./home-service";
import { PANELS, layoutOf, type PanelKey } from "./panels";

const FEATURES = ["home", "students", "staff", "academics", "attendance", "fees", "finance", "exams", "timetable", "assignments", "announcements", "events", "website", "support", "notifications", "setup", "library", "transport", "payroll", "messages", "meetings", "requests", "settings", "billing"];
let a: TestSchool;
beforeAll(async () => { ({ a } = await createSchoolPair(FEATURES, "-needs")); await buildSchoolData(a); });
afterAll(closeDb);

const FAMILY = new Set<PanelKey>(["family-answer", "family-classes", "family-homework", "family-dues", "family-attendance", "family-exam", "family-result", "family-meeting", "family-bus", "family-library"]);
/** The panels of the admin's page: a custom role cannot be given them by grants alone. */
const ADMIN_PAGE = new Set<PanelKey>(["today", "getting-started", "numbers", "attention", "attendance-week", "money-trend", "funnel", "leave", "birthdays", "plan", "events"]);

/** A login that holds exactly the panel's `needs` and nothing else. */
const holding = (key: PanelKey): Ctx => {
  // The left panel needs nothing but being a student who left (no custom grants).
  if (key === "left") return { ...a.as.student, features: new Set(["home", "fees", "exams", "notifications", "settings"]), leftUntil: "2027-02-01" };
  const grants = new Set(["home:view", ...PANELS[key].needs]);
  const base = FAMILY.has(key) ? a.as.student : ADMIN_PAGE.has(key) ? a.as.admin : a.as.accountant;
  return { ...base, role: FAMILY.has(key) ? "student" : ADMIN_PAGE.has(key) ? "admin" : "staff", grants };
};

describe("every panel's needs are enough for its data call", () => {
  it.each(Object.keys(PANELS) as PanelKey[])("%s: a login holding exactly its needs gets the panel, not a refusal", async (key) => {
    const ctx = holding(key);
    expect(layoutOf(ctx), "the panel is on that login's home").toContain(key);
    const slot = await new HomeService(ctx).panel(key);
    // `off` here would be a Forbidden the registry did not foresee (every module is on in this school).
    expect(slot.state, `${key} needs ${PANELS[key].needs.join(", ")}`).toBe("ok");
  });

  it("and one grant short of its needs, the panel is not shown", async () => {
    for (const key of Object.keys(PANELS) as PanelKey[]) for (const need of PANELS[key].needs) {
      const ctx = holding(key), short = { ...ctx, grants: new Set([...ctx.grants!].filter((g) => g !== need)) };
      expect((await new HomeService(short).panel(key)).state, `${key} without ${need}`).toBe("off");
    }
  });
});
