import { describe, expect, it } from "vitest";
import { dueHint, isLate, parseDue, selfState, sortSelf, tally, toIstInput, turnedIn } from "./rules";

describe("due dates", () => {
  it("reads a form value as India time and round-trips it", () => {
    expect(parseDue("2026-11-20T17:00")?.toISOString()).toBe("2026-11-20T11:30:00.000Z");
    expect(toIstInput(parseDue("2026-11-20T17:00"))).toBe("2026-11-20T17:00");
  });
  it("keeps an explicit zone and rejects junk", () => {
    expect(parseDue("2026-11-20T10:00:00Z")?.toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(parseDue("2026-11-20T10:00:00+05:30")?.toISOString()).toBe("2026-11-20T04:30:00.000Z");
    expect(parseDue("")).toBeNull();
    expect(parseDue("not a date")).toBeNull();
    expect(parseDue("2026-11-20")).toBeNull();
  });
  it("late means strictly after the due time", () => {
    const due = new Date("2026-11-20T10:00:00Z");
    expect(isLate(due, new Date("2026-11-20T10:00:00Z"))).toBe(false);
    expect(isLate(due, new Date("2026-11-20T10:00:01Z"))).toBe(true);
  });
});

describe("what a student sees", () => {
  const now = new Date("2026-11-18T10:00:00Z");
  const due = (days: number) => new Date(now.getTime() + days * 86_400_000);
  it("maps work to a state", () => {
    expect(selfState({ dueAt: due(1), status: "published" }, null, now)).toBe("todo");
    expect(selfState({ dueAt: due(-1), status: "published" }, null, now)).toBe("overdue");
    expect(selfState({ dueAt: due(1), status: "closed" }, null, now)).toBe("overdue");
    expect(selfState({ dueAt: due(1), status: "published" }, { status: "graded" }, now)).toBe("graded");
  });
  it("sorts open work by nearest due date, then missed, then handed in", () => {
    const rows = sortSelf([
      { state: "graded" as const, dueAt: due(-9) }, { state: "overdue" as const, dueAt: due(-2) }, { state: "todo" as const, dueAt: due(5) },
      { state: "returned" as const, dueAt: due(2) }, { state: "overdue" as const, dueAt: due(-4) }, { state: "submitted" as const, dueAt: due(-1) },
    ]);
    expect(rows.map((r) => r.state)).toEqual(["returned", "todo", "overdue", "overdue", "submitted", "graded"]);
    expect(rows[2]!.dueAt.getTime()).toBeGreaterThan(rows[3]!.dueAt.getTime());
  });
});

describe("progress", () => {
  it("missing is the class minus everyone who handed in, never negative", () => {
    expect(tally(30, { submitted: 10, late: 4, graded: 6 })).toEqual({ total: 30, submitted: 10, late: 4, graded: 6, returned: 0, missing: 10 });
    expect(tally(2, { submitted: 3 }).missing).toBe(0);
  });
  it("turned in is a rounded percentage", () => {
    expect(turnedIn(tally(30, { submitted: 10, late: 4, graded: 6 }))).toBe(67);
    expect(turnedIn(tally(0, {}))).toBe(0);
  });
});

describe("due hints", () => {
  const now = new Date("2026-11-18T10:00:00Z"); // 3:30 pm in India
  it("counts calendar days in India time", () => {
    expect(dueHint(new Date("2026-11-18T12:00:00Z"), now)).toBe("Due today");
    expect(dueHint(new Date("2026-11-19T11:30:00Z"), now)).toBe("Due tomorrow");
    expect(dueHint(new Date("2026-11-21T11:30:00Z"), now)).toBe("Due in 3 days");
    // 11 pm India time on the 18th is still today
    expect(dueHint(new Date("2026-11-18T17:30:00Z"), now)).toBe("Due today");
    expect(dueHint(new Date("2026-11-18T09:00:00Z"), now)).toBe("Overdue");
    expect(dueHint(new Date("2026-11-16T09:00:00Z"), now)).toBe("2 days overdue");
    expect(dueHint(new Date("2026-11-17T09:00:00Z"), now)).toBe("1 day overdue");
  });
});
