import { describe, expect, it } from "vitest";
import { addWorkingHours, expectedReplyBy, nextWorkingMoment, replyHours, slaState, workingHoursBetween } from "./sla";

// 2026-11-23 is a Monday, 28 a Saturday, 29 a Sunday.
const ist = (s: string) => new Date(`2026-11-${s}:00+05:30`);
const show = (d: Date) => d.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");

describe("working-hours clock (9 to 18 IST, Monday to Saturday)", () => {
  it("counts inside a working day", () => {
    expect(show(addWorkingHours(ist("23T10:00"), 2))).toBe("Mon 23 12:00");
  });
  it("carries the rest of the hours over to the next morning", () => {
    expect(show(addWorkingHours(ist("23T17:00"), 2))).toBe("Tue 24 10:00");
  });
  it("Saturday evening carries over to Monday, skipping Sunday", () => {
    expect(show(addWorkingHours(ist("28T17:00"), 2))).toBe("Mon 30 10:00");
  });
  it("a ticket sent on Sunday or before opening starts at the next opening", () => {
    expect(show(addWorkingHours(ist("29T11:00"), 1))).toBe("Mon 30 10:00");
    expect(show(addWorkingHours(ist("23T06:30"), 1))).toBe("Mon 23 10:00");
    expect(show(nextWorkingMoment(ist("23T19:00")))).toBe("Tue 24 09:00");
  });
  it("24 working hours from Monday 19:00 is Thursday 15:00", () => {
    expect(show(addWorkingHours(ist("23T19:00"), 24))).toBe("Thu 26 15:00");
  });
  it("measures working hours between two instants", () => {
    expect(workingHoursBetween(ist("23T10:00"), ist("24T10:00"))).toBe(9);
    expect(workingHoursBetween(ist("28T17:00"), ist("30T10:00"))).toBe(2);
    expect(workingHoursBetween(ist("23T12:00"), ist("23T10:00"))).toBe(0);
    expect(workingHoursBetween(ist("29T10:00"), ist("29T16:00"))).toBe(0);
  });
});

describe("reply targets by priority and plan", () => {
  it("2, 8, 24 and 72 working hours", () => {
    expect([replyHours("urgent"), replyHours("high"), replyHours("normal"), replyHours("low")]).toEqual([2, 8, 24, 72]);
  });
  it("urgent is halved on Pro and Enterprise only", () => {
    expect(replyHours("urgent", "pro")).toBe(1);
    expect(replyHours("urgent", "enterprise")).toBe(1);
    expect(replyHours("urgent", "starter")).toBe(2);
    expect(replyHours("normal", "pro")).toBe(24);
  });
  it("a ticket with no stored time shows the time the clock will set", () => {
    const createdAt = ist("23T10:00");
    expect(show(expectedReplyBy({ createdAt, priority: "urgent", replyDueAt: null }))).toBe("Mon 23 12:00");
    const due = ist("25T10:00");
    expect(expectedReplyBy({ createdAt, priority: "urgent", replyDueAt: due })).toBe(due);
  });
});

describe("SLA state", () => {
  const due = ist("23T12:00");
  it("met, late, ok, soon, overdue, none", () => {
    expect(slaState({ status: "pending", replyDueAt: due, firstReplyAt: ist("23T11:00") })).toBe("met");
    expect(slaState({ status: "pending", replyDueAt: due, firstReplyAt: ist("23T13:00") })).toBe("late");
    expect(slaState({ status: "open", replyDueAt: due, firstReplyAt: null }, ist("23T09:30"))).toBe("ok");
    expect(slaState({ status: "open", replyDueAt: due, firstReplyAt: null }, ist("23T10:30"))).toBe("soon");
    expect(slaState({ status: "open", replyDueAt: due, firstReplyAt: null }, ist("23T12:01"))).toBe("overdue");
    expect(slaState({ status: "closed", replyDueAt: due, firstReplyAt: null }, ist("24T12:01"))).toBe("none");
    expect(slaState({ status: "open", replyDueAt: null, firstReplyAt: null })).toBe("none");
  });
});
