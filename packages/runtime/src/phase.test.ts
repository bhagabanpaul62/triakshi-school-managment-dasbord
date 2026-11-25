import { describe, expect, it } from "vitest";
import { featuresFor, leftMayOpen, leftUntilOf, LEFT_FEATURES } from "./phase";

const ALL = new Set(["students", "attendance", "fees", "exams", "home", "notifications", "settings", "messages", "announcements", "library", "website"]);
const left = { status: "left" as const, leftOn: "2026-12-01", joinsOn: null };
const NOW = new Date("2026-12-20T10:00:00+05:30");

describe("featuresFor", () => {
  it("a left student keeps exactly fees, exams, home, notifications and settings, and no more", () => {
    expect([...featuresFor(ALL, left, NOW)].sort()).toEqual(["exams", "fees", "home", "notifications", "settings"]);
    expect(featuresFor(new Set(["fees", "messages"]), left, NOW)).toEqual(new Set(["fees"])); // a module the school does not have stays off
  });
  it("alumni by promotion is the same", () => {
    expect([...featuresFor(ALL, { ...left, status: "alumni" }, NOW)].sort()).toEqual([...LEFT_FEATURES].sort());
  });
  it("everyone else is unchanged: no student row, active student, staff, a custom role", () => {
    expect(featuresFor(ALL, null, NOW)).toBe(ALL);
    expect(featuresFor(ALL, { status: "active", leftOn: null, joinsOn: null }, NOW)).toBe(ALL);
  });
  it("on the day after the 90th it is full again only because the session is gone: the function never widens", () => {
    expect(featuresFor(ALL, left, new Date("2027-03-05T10:00:00+05:30"))).toBe(ALL); // closed sessions never reach the builders; the pure rule says "not limited"
  });
  it("leftUntilOf is set only inside the 90 days", () => {
    expect(leftUntilOf(left, NOW)).toBe("2027-03-01");
    expect(leftUntilOf(null, NOW)).toBeUndefined();
    expect(leftUntilOf({ status: "active", leftOn: null, joinsOn: null }, NOW)).toBeUndefined();
  });
});

describe("leftMayOpen", () => {
  it("opens home, dues and receipts, results, notifications and the profile; refuses the rest", () => {
    for (const p of ["/app", "/app/fees", "/app/fees/receipts/abc", "/app/results", "/app/results/x/y", "/app/notifications/preferences", "/app/profile", "/app/profile/data", "/app/not-available"]) expect(leftMayOpen(p), p).toBe(true);
    for (const p of ["/app/messages", "/app/announcements/1", "/app/attendance", "/app/events", "/app/library", "/app/feesx", "/app/students", "/app/settings"]) expect(leftMayOpen(p), p).toBe(false);
  });
});
