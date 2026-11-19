import { describe, expect, it } from "vitest";
import { createSchoolInput } from "./inputs";
import { DESIGN_FLOW, DESIGN_STATUSES, canMove } from "./design-requests";
import { monthlyPaise } from "./overview";

describe("design request flow", () => {
  it("moves forward only, and delivered or cancelled are final", () => {
    expect(canMove("requested", "quoted")).toBe(true);
    expect(canMove("requested", "paid")).toBe(false);
    expect(canMove("quoted", "quoted")).toBe(true);
    expect(canMove("in_review", "in_progress")).toBe(true);
    expect(DESIGN_FLOW.delivered).toEqual([]);
    expect(DESIGN_FLOW.cancelled).toEqual([]);
  });
  it("every target is a known status", () => {
    for (const to of Object.values(DESIGN_FLOW).flat()) expect(DESIGN_STATUSES).toContain(to);
  });
});

describe("monthlyPaise", () => {
  it("counts an annual price as a twelfth and a monthly price as is", () => {
    expect(monthlyPaise({ interval: "annual", pricePaise: 1_200_000 })).toBe(100_000);
    expect(monthlyPaise({ interval: "monthly", pricePaise: 99_900 })).toBe(99_900);
  });
});

describe("createSchoolInput", () => {
  const ok = { name: "St Mary's School", slug: "StMarys", adminName: "Asha Rao", adminEmail: "asha@stmarys.test" };
  it("lower-cases the address", () => { expect(createSchoolInput.parse(ok).slug).toBe("stmarys"); });
  it("rejects reserved and malformed addresses", () => {
    expect(createSchoolInput.safeParse({ ...ok, slug: "admin" }).success).toBe(false);
    expect(createSchoolInput.safeParse({ ...ok, slug: "a" }).success).toBe(false);
    expect(createSchoolInput.safeParse({ ...ok, slug: "-bad-" }).success).toBe(false);
    expect(createSchoolInput.safeParse({ ...ok, slug: "has space" }).success).toBe(false);
  });
  it("needs a valid administrator email", () => { expect(createSchoolInput.safeParse({ ...ok, adminEmail: "nope" }).success).toBe(false); });
});
