import { describe, expect, it } from "vitest";
import { quietUntil, type QuietRule } from "./quiet";

const rule: QuietRule = { from: "20:00", to: "07:00", sundays: true };
// IST is UTC+5:30. 2026-11-25 is a Wednesday, 2026-11-29 a Sunday.
const ist = (s: string) => new Date(`${s}+05:30`);
const until = (now: string, r: Partial<QuietRule> = {}) => quietUntil(ist(now), { ...rule, ...r })?.toISOString() ?? null;
const at = (s: string) => ist(s).toISOString();

describe("quietUntil", () => {
  it("is null in the day", () => {
    expect(until("2026-11-25T07:00:00")).toBeNull();
    expect(until("2026-11-25T12:00:00")).toBeNull();
    expect(until("2026-11-25T19:59:00")).toBeNull();
  });
  it("overnight window: evening runs to next morning, early morning to the same morning", () => {
    expect(until("2026-11-25T20:00:00")).toBe(at("2026-11-26T07:00:00"));
    expect(until("2026-11-25T23:30:00")).toBe(at("2026-11-26T07:00:00"));
    expect(until("2026-11-26T00:00:00")).toBe(at("2026-11-26T07:00:00"));
    expect(until("2026-11-26T06:59:59")).toBe(at("2026-11-26T07:00:00"));
  });
  it("uses IST, not UTC: 20:30 IST is 15:00 UTC", () => {
    expect(quietUntil(new Date("2026-11-25T15:00:00Z"), rule)?.toISOString()).toBe(at("2026-11-26T07:00:00"));
    expect(quietUntil(new Date("2026-11-25T14:00:00Z"), rule)).toBeNull(); // 19:30 IST
  });
  it("same-day window", () => {
    const day = { from: "13:00", to: "15:00" };
    expect(until("2026-11-25T14:00:00", day)).toBe(at("2026-11-25T15:00:00"));
    expect(until("2026-11-25T15:00:00", day)).toBeNull();
    expect(until("2026-11-25T12:59:00", day)).toBeNull();
  });
  it("no window when from equals to", () => {
    expect(until("2026-11-25T23:00:00", { from: "07:00", to: "07:00" })).toBeNull();
  });
  it("Sunday is quiet all day and runs on to Monday morning", () => {
    expect(until("2026-11-29T12:00:00")).toBe(at("2026-11-30T07:00:00"));
    expect(until("2026-11-29T00:00:00")).toBe(at("2026-11-30T07:00:00"));
    expect(until("2026-11-29T23:59:00")).toBe(at("2026-11-30T07:00:00"));
    expect(until("2026-11-28T21:00:00")).toBe(at("2026-11-30T07:00:00")); // Saturday night rolls through Sunday
    expect(until("2026-11-29T12:00:00", { sundays: false })).toBeNull();
    expect(until("2026-11-29T22:00:00", { sundays: false })).toBe(at("2026-11-30T07:00:00"));
  });
  it("away until a date: quiet until that morning ends", () => {
    expect(until("2026-11-25T12:00:00", { awayUntil: "2026-11-27" })).toBe(at("2026-11-27T07:00:00"));
    expect(until("2026-11-27T12:00:00", { awayUntil: "2026-11-27" })).toBeNull();
    expect(until("2026-11-27T12:00:00", { awayUntil: "2026-11-26" })).toBeNull();
    expect(until("2026-11-25T12:00:00", { awayUntil: "2026-11-29" })).toBe(at("2026-11-30T07:00:00")); // returns on a Sunday
    expect(until("2026-11-25T12:00:00", { awayUntil: null })).toBeNull();
  });
});
