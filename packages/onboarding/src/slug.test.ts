import { describe, expect, it } from "vitest";
import { SlugPolicy } from "./slug";

describe("SlugPolicy", () => {
  it.each(["abc", "st-marys", "dps2", "a".repeat(30)])("accepts %s", (s) => expect(SlugPolicy.check(s)).toBeNull());
  it.each(["ab", "a".repeat(31), "Upper", "has space", "under_score", "-lead", "trail-", "dou--ble", "école"])("rejects %s", (s) => expect(SlugPolicy.check(s)).not.toBeNull());
  it.each([...SlugPolicy.RESERVED])("blocks reserved %s", (s) => expect(SlugPolicy.check(s)).toMatch(/reserved/));
  it("normalizes names", () => {
    expect(SlugPolicy.normalize("St. Mary's  School")).toBe("st-mary-s-school");
    expect(SlugPolicy.normalize("  École Française ")).toBe("ecole-francaise");
    expect(SlugPolicy.normalize("x".repeat(50))).toHaveLength(30);
  });
  it("suggests the first free numbered slug", async () => {
    const taken = new Set(["dps-2", "dps-3"]);
    expect(await SlugPolicy.suggest("dps", async (s) => taken.has(s))).toBe("dps-4");
    expect(await SlugPolicy.suggest("a", async () => false)).toBeNull();
  });
});

describe("signup input hygiene", () => {
  it("rejects line breaks in names (email header injection)", async () => {
    const { signupSchema } = await import("./schema");
    const r = signupSchema.safeParse({ name: "School\r\nBcc: x@y.z", adminName: "A B", email: "a@b.in", phone: "9876543210", state: "Goa", city: "Panaji", board: "CBSE", approxStudents: 5, slug: "goodslug" });
    expect(r.success).toBe(false);
  });
});
