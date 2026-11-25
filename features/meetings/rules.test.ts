import { describe, expect, it } from "vitest";
import { atIst, breaksOf, buildGrid, istDay, istHm, parseIstInput, reconcile, type Existing } from "./rules";

const span = (from: string, to: string) => ({ startsAt: atIst("2026-12-05", from), endsAt: atIst("2026-12-05", to) });
const ex = (id: string, from: string, to: string, state: Existing["state"], studentId: string | null = null): Existing => ({ id, ...span(from, to), state, studentId });

describe("India time", () => {
  it("reads form values as IST", () => {
    expect(parseIstInput("2026-12-05T10:30")?.toISOString()).toBe("2026-12-05T05:00:00.000Z");
    expect(istDay(new Date("2026-12-05T20:00:00Z"))).toBe("2026-12-06");
    expect(istHm(new Date("2026-12-05T05:00:00Z"))).toBe("10:30");
    expect(parseIstInput("nonsense")).toBeNull();
  });
});

describe("slot grid", () => {
  it("makes back-to-back slots, drops a short tail and marks breaks", () => {
    const g = buildGrid(span("10:00", "11:25"), 10, [span("10:30", "10:50")]);
    expect(g).toHaveLength(8);
    expect(g.filter((c) => c.state === "break")).toHaveLength(2);
  });
  it("reads breaks back from break slots", () => {
    const g = buildGrid(span("10:00", "11:00"), 10, [span("10:20", "10:40")]);
    const slots = g.map((c, i) => ({ id: String(i), ...c, studentId: null }));
    expect(breaksOf(slots)).toEqual([span("10:20", "10:40")]);
  });
});

describe("reconcile", () => {
  it("keeps what fits, drops free slots that fall off, and lists booked ones that fall off", () => {
    const old = [ex("a", "10:00", "10:10", "open"), ex("b", "10:10", "10:20", "booked", "s1"), ex("c", "10:20", "10:30", "open"), ex("d", "10:30", "10:40", "booked", "s2")];
    const p = reconcile(buildGrid(span("10:00", "10:30"), 10), old);
    expect(p.remove).toEqual([]);
    expect(p.drop.map((d) => d.id)).toEqual(["d"]);
    const q = reconcile(buildGrid(span("10:00", "10:20"), 10), old);
    expect(q.remove).toEqual(["c"]);
    expect(q.drop.map((d) => d.id)).toEqual(["d"]);
  });
  it("a booked slot that turns into a break is dropped; free ones become break and back", () => {
    const old = [ex("a", "10:00", "10:10", "open"), ex("b", "10:10", "10:20", "booked", "s1"), ex("c", "10:20", "10:30", "break")];
    const p = reconcile(buildGrid(span("10:00", "10:30"), 10, [span("10:00", "10:20")]), old);
    expect(p.toBreak).toEqual(["a"]);
    expect(p.drop.map((d) => d.id)).toEqual(["b"]);
    expect(p.toOpen).toEqual(["c"]);
    expect(p.insert.map((c) => c.state)).toEqual(["break"]);
  });
  it("a moved window rebuilds the grid and keeps no booking that no longer lines up", () => {
    const old = [ex("a", "10:00", "10:10", "booked", "s1")];
    const p = reconcile(buildGrid(span("10:05", "10:25"), 10), old);
    expect(p.drop).toHaveLength(1);
    expect(p.insert).toHaveLength(2);
  });
});
