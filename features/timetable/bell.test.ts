import { describe, expect, it } from "vitest";
import { cellKey, nowAndNext } from "./bell";

const periods = [
  { id: "p1", startsAt: "08:00", endsAt: "08:40", isBreak: false },
  { id: "p2", startsAt: "08:40", endsAt: "09:20", isBreak: false },
  { id: "b", startsAt: "09:20", endsAt: "09:40", isBreak: true },
];
const cells = { [cellKey(2, "p1")]: "maths", [cellKey(2, "p2")]: "science", [cellKey(3, "p1")]: "english" };
const at = (iso: string) => nowAndNext(periods, cells, new Date(iso));

describe("nowAndNext", () => {
  it("finds the class in progress and the one after it", () => {
    const r = at("2026-11-17T02:50:00Z"); // Tuesday 8:20 in India
    expect(r.now?.cell).toBe("maths");
    expect(r.next).toMatchObject({ cell: "science", today: true });
  });
  it("between classes only has a next", () => {
    const r = at("2026-11-17T03:55:00Z"); // Tuesday 9:25, break
    expect(r.now).toBeNull();
    expect(r.next).toMatchObject({ cell: "english", day: 3, today: false });
  });
  it("on Sunday the next class is the next school day", () => {
    const r = at("2026-11-22T04:30:00Z");
    expect(r.now).toBeNull();
    expect(r.next).toMatchObject({ cell: "maths", day: 2, today: false });
  });
});
