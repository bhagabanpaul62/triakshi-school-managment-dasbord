import { describe, expect, it } from "vitest";
import { addDays, autoCloseAt, dueFor, escalatedWords, familyMayReopen, isOverdue, median, nextLevel, resumeDue } from "./clock";
import { allowed, next } from "./transitions";
import type { RequestState } from "./constants";

const T0 = new Date("2026-11-02T10:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);

describe("clock", () => {
  it("target days are calendar days", () => {
    expect(dueFor(T0, 3).toISOString()).toBe("2026-11-05T10:00:00.000Z");
    expect(addDays(T0, 0).getTime()).toBe(T0.getTime());
  });

  it("waiting for the family stops the clock and gives every waited hour back", () => {
    const due = dueFor(T0, 2);
    const paused = hours(10), answered = hours(34);
    expect(resumeDue(due, paused, answered).getTime() - due.getTime()).toBe(24 * 3_600_000);
    expect(resumeDue(due, answered, paused).getTime()).toBe(due.getTime());
  });

  it("a paused or finished request is never overdue", () => {
    const base = { dueAt: hours(1), pausedAt: null };
    expect(isOverdue({ ...base, state: "in_progress" }, hours(2))).toBe(true);
    expect(isOverdue({ ...base, state: "in_progress" }, hours(0))).toBe(false);
    expect(isOverdue({ ...base, pausedAt: hours(0), state: "waiting" }, hours(5))).toBe(false);
    expect(isOverdue({ ...base, state: "resolved" }, hours(5))).toBe(false);
  });

  it("windows: 7 days to auto close, 14 days for the family to reopen", () => {
    expect(autoCloseAt(T0).getTime() - T0.getTime()).toBe(7 * 86_400_000);
    expect(familyMayReopen(T0, addDays(T0, 14))).toBe(true);
    expect(familyMayReopen(T0, new Date(addDays(T0, 14).getTime() + 1))).toBe(false);
  });

  it("levels run in order and stop at the top", () => {
    const levels = [{ label: "Office", role: "admin", afterDays: 2 }];
    expect(nextLevel(levels, 0)?.label).toBe("Office");
    expect(nextLevel(levels, 1)).toBeNull();
  });

  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("state table", () => {
  const all: RequestState[] = ["new", "assigned", "in_progress", "waiting", "resolved", "closed"];
  it("follows the flow of the PRD", () => {
    expect(next("new", "assign")).toBe("assigned");
    expect(next("assigned", "start")).toBe("in_progress");
    expect(next("in_progress", "ask")).toBe("waiting");
    expect(next("waiting", "familyReply")).toBe("in_progress");
    expect(next("in_progress", "resolve")).toBe("resolved");
    expect(next("resolved", "close")).toBe("closed");
    expect(next("closed", "reopen", true)).toBe("assigned");
    expect(next("resolved", "reopen", false)).toBe("new");
  });
  it("a finished request cannot be answered, asked, started or merged", () => {
    for (const s of ["resolved", "closed"] as const) for (const a of ["answer", "ask", "start", "merge", "assign", "resolve"] as const) expect(next(s, a)).toBeNull();
  });
  it("escalating keeps the state of an open request and opens a resolved one", () => {
    expect(next("waiting", "escalate")).toBe("waiting");
    expect(next("resolved", "escalate", true)).toBe("assigned");
    expect(next("closed", "escalate")).toBeNull();
  });
  it("every action is allowed from at least one state and refused from at least one", () => {
    for (const a of ["assign", "start", "answer", "ask", "familyReply", "resolve", "close", "reopen", "escalate", "merge"] as const) {
      expect(all.some((s) => allowed(s, a))).toBe(true);
      expect(all.some((s) => !allowed(s, a))).toBe(true);
    }
  });
});

describe("words the screens use", () => {
  it("the report says 'Not yet' with nothing finished, never '0 hours'; ages carry a unit", async () => {
    const { hoursWords, ageWords } = await import("./clock");
    expect(hoursWords(null)).toBe("Not yet");
    expect(hoursWords(0.02)).toBe("Under an hour");
    expect(hoursWords(5.54)).toBe("5.5 hours");
    expect(hoursWords(72)).toBe("3 days");
    expect(ageWords(0)).toBe("Today");
    expect(ageWords(1)).toBe("1 day");
    expect(ageWords(5)).toBe("5 days");
  });
  it("says how often it was escalated", () => {
    expect([1, 2, 3].map(escalatedWords)).toEqual(["once", "twice", "3 times"]);
  });
});
