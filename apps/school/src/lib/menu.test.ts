import { describe, expect, it } from "vitest";
import type { Ctx } from "@smw/feature-kit";
import { leftMayOpen } from "@smw/runtime/phase";
import { FEATURES } from "@/generated/features";
import { buildMenu } from "./menu";

const ALL = new Set(FEATURES.map((f) => f.key));
const student = (o: Partial<Ctx> = {}): Ctx => ({ schoolId: "s", userId: "u", role: "student", name: "Kid", features: ALL, readOnly: false, ...o });
const hrefs = (ctx: Ctx) => buildMenu(ctx).flatMap((g) => g.items.map((i) => i.href));

describe("the menu of a student who left", () => {
  const left = student({ features: new Set(["fees", "exams", "home", "notifications", "settings"]), leftUntil: "2027-02-01" });

  it("holds only pages the login can open: nothing ends in a refusal", () => {
    const list = hrefs(left);
    expect(list).toContain("/app");
    expect(list.length).toBeGreaterThan(2);
    for (const h of list) expect(leftMayOpen(h.split("?")[0]!), h).toBe(true);
  });

  it("an active student, staff and a custom role keep the whole menu", () => {
    const full = hrefs(student());
    expect(full).toEqual(expect.arrayContaining(["/app/announcements", "/app/messages"]));
    expect(hrefs({ ...student(), role: "teacher" }).length).toBeGreaterThan(3);
    expect(hrefs({ ...student(), role: "staff", grants: new Set(["home:view", "library:read"]) })).toContain("/app/library");
  });
});
