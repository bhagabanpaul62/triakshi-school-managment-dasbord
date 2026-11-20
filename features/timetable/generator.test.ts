import { describe, expect, it } from "vitest";
import { generate, rng, validateInput, type GenDemand, type GenInput, type GenResult } from "./generator";

const DAYS = [1, 2, 3, 4, 5, 6];
// 8 periods, a break between 4 and 5 (so period 5 is "afterBreak").
const PERIODS = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, name: `Period ${i + 1}`, afterBreak: i === 4 }));

/** A made-up school: `n` sections of 4 classes, 8 subjects, a teacher pool sized so the week is feasible. */
function school(n: number, seed: number, extra: Partial<GenInput> = {}): GenInput {
  const r = rng(seed);
  const sections = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `S${i}`, classTeacherId: `t${i % 20}` }));
  const subjects = ["maths", "eng", "sci", "hin", "soc", "cs", "art", "pe"];
  const perWeek = [6, 5, 5, 5, 4, 3, 2, 2]; // 32 of 48 slots
  const demands: GenDemand[] = [];
  sections.forEach((s, i) => subjects.forEach((sub, j) => demands.push({
    id: `${s.id}-${sub}`, sectionId: s.id, subjectId: sub, teacherId: `t${(i + j * 3 + Math.floor(r() * 2)) % Math.max(20, Math.ceil(n * 0.9))}`,
    count: perWeek[j]!, doubles: sub === "sci" ? 1 : 0, roomKind: null,
  })));
  return { sections, days: DAYS, periods: PERIODS, demands, seed, budgetMs: 20_000, ...extra };
}

/** Every hard rule, checked against a result. */
function assertSound(inp: GenInput, res: GenResult) {
  const seen = new Set<string>(); const tSeen = new Set<string>(); const rSeen = new Set<string>();
  const perDay = new Map<string, number>(); const perWeek = new Map<string, number>();
  for (const p of res.placements) {
    expect(PERIODS.some((x) => x.id === p.periodId)).toBe(true); // breaks are never in the list
    const c = `${p.sectionId}|${p.day}|${p.periodId}`;
    expect(seen.has(c), `section double-booked ${c}`).toBe(false); seen.add(c);
    if (p.teacherId) {
      const t = `${p.teacherId}|${p.day}|${p.periodId}`;
      expect(tSeen.has(t), `teacher clash ${t}`).toBe(false); tSeen.add(t);
      perDay.set(`${p.teacherId}|${p.day}`, (perDay.get(`${p.teacherId}|${p.day}`) ?? 0) + 1);
      perWeek.set(p.teacherId, (perWeek.get(p.teacherId) ?? 0) + 1);
      const rule = inp.teacherRules?.[p.teacherId];
      expect(rule?.unavailable?.some((u) => u.day === p.day && u.periodId === p.periodId) ?? false).toBe(false);
    }
    if (p.roomId) { const k = `${p.roomId}|${p.day}|${p.periodId}`; expect(rSeen.has(k)).toBe(false); rSeen.add(k); }
  }
  for (const [k, n] of perDay) { const m = inp.teacherRules?.[k.split("|")[0]!]?.maxPerDay; if (m) expect(n).toBeLessThanOrEqual(m); }
  for (const [t, n] of perWeek) { const m = inp.teacherRules?.[t]?.maxPerWeek; if (m) expect(n).toBeLessThanOrEqual(m); }
}

describe("generator", () => {
  it("never clashes, across several seeded random schools", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const inp = school(8, seed, { teacherRules: { t0: { maxPerDay: 6, maxPerWeek: 30 }, t1: { unavailable: [{ day: 6, periodId: "p1" }, { day: 1, periodId: "p2" }] } } });
      const res = generate(inp);
      assertSound(inp, res);
      expect(res.stats.placed + res.stats.unplaced).toBe(res.stats.demanded);
      expect(res.stats.placed).toBeGreaterThan(res.stats.demanded * 0.9);
    }
  });

  it("keeps locked cells exactly as given and counts them against the demand", () => {
    const inp = school(4, 7);
    const locked = [{ sectionId: "s0", day: 2, periodId: "p3", subjectId: "maths", teacherId: "t0" }];
    const res = generate({ ...inp, locked });
    const cell = res.placements.find((p) => p.sectionId === "s0" && p.day === 2 && p.periodId === "p3")!;
    expect(cell).toMatchObject({ subjectId: "maths", teacherId: "t0", locked: true });
    expect(res.placements.filter((p) => p.sectionId === "s0" && p.subjectId === "maths")).toHaveLength(6);
    assertSound(inp, res);
  });

  it("respects teacher unavailability", () => {
    const inp = school(6, 3, { teacherRules: { t1: { unavailable: DAYS.map((day) => ({ day, periodId: "p1" })) }, t2: { unavailable: PERIODS.map((p) => ({ day: 6, periodId: p.id })) } } });
    const res = generate(inp);
    assertSound(inp, res);
    expect(res.placements.filter((p) => p.teacherId === "t2" && p.day === 6)).toHaveLength(0);
  });

  it("places double periods back to back and never across the break", () => {
    const inp = school(6, 9);
    const res = generate(inp);
    for (const s of inp.sections) {
      const sci = res.placements.filter((p) => p.sectionId === s.id && p.subjectId === "sci");
      const byDay = new Map<number, number[]>();
      for (const p of sci) byDay.set(p.day, [...(byDay.get(p.day) ?? []), PERIODS.findIndex((x) => x.id === p.periodId)].sort((a, b) => a - b));
      const pair = [...byDay.values()].find((v) => v.length >= 2 && v[1]! - v[0]! === 1);
      expect(pair, `no double for ${s.id}`).toBeDefined();
      expect(pair![1]).not.toBe(4);
    }
  });

  it("gives the same result for the same seed, and a different one for another", () => {
    const a = generate(school(6, 11)); const b = generate(school(6, 11)); const c = generate(school(6, 12));
    expect(b.placements).toEqual(a.placements);
    expect(c.placements).not.toEqual(a.placements);
  });

  it("reports an impossible demand with a reason instead of dropping it", () => {
    const inp: GenInput = {
      sections: [{ id: "s0", label: "S0", classTeacherId: null }], days: [1, 2], periods: PERIODS.slice(0, 3), seed: 1,
      demands: [{ id: "d1", sectionId: "s0", subjectId: "maths", teacherId: "t0", count: 5, doubles: 0, roomKind: null }],
      teacherRules: { t0: { maxPerWeek: 3 } }, names: { teacher: { t0: "Mr X" } },
    };
    const res = generate(inp);
    expect(res.placements).toHaveLength(3);
    expect(res.unplaced).toEqual([expect.objectContaining({ demandId: "d1", missing: 2, reason: expect.stringContaining("Mr X") })]);
    expect(res.stats).toMatchObject({ demanded: 5, placed: 3, unplaced: 2 });
    expect(validateInput(inp).map((i) => i.message).join(" ")).toContain("Mr X is asked for 5 periods but can take at most 3");
  });

  it("books labs without double-booking them, and reports when there are none", () => {
    const inp = school(4, 5);
    const labDemands = inp.demands.map((d) => (d.subjectId === "cs" ? { ...d, roomKind: "computer" } : d));
    const res = generate({ ...inp, demands: labDemands, rooms: [{ id: "lab1", name: "Lab 1", kind: "computer" }] });
    assertSound(inp, res);
    expect(res.placements.filter((p) => p.roomId === "lab1")).toHaveLength(12);
    const none = generate({ ...inp, demands: labDemands });
    expect(none.unplaced.filter((u) => u.subjectId === "cs")).toHaveLength(4);
    expect(validateInput({ ...inp, demands: labDemands }).some((i) => i.message.includes('"computer" room'))).toBe(true);
  });

  it("puts the class teacher in period 1 when the section has one of their lessons", () => {
    const inp = school(3, 2);
    const ct = inp.demands[0]!.teacherId;
    inp.sections[0]!.classTeacherId = ct;
    const res = generate(inp);
    const first = res.placements.filter((p) => p.sectionId === "s0" && p.periodId === "p1");
    expect(first.filter((p) => p.teacherId === ct).length).toBeGreaterThanOrEqual(4);
  });

  it("does not repeat a subject on a day unless it is a double", () => {
    const inp = school(4, 6);
    const res = generate(inp);
    const count = new Map<string, number>();
    for (const p of res.placements.filter((x) => x.subjectId === "eng")) count.set(`${p.sectionId}|${p.day}`, (count.get(`${p.sectionId}|${p.day}`) ?? 0) + 1);
    expect(Math.max(...count.values())).toBe(1);
  });

  it("flags a class that needs more periods than the week has", () => {
    const inp = school(1, 1);
    inp.demands = inp.demands.map((d, i) => (i === 0 ? { ...d, count: 30 } : d));
    expect(validateInput(inp).some((i) => i.message.includes("needs 56 periods but the week has 48 slots"))).toBe(true);
  });

  it("a 40-section school finishes well inside the budget", () => {
    const inp = school(40, 21, { budgetMs: 20_000 });
    const res = generate(inp);
    assertSound(inp, res);
    expect(res.stats.timedOut).toBe(false);
    expect(res.stats.ms).toBeLessThan(20_000);
    expect(res.stats.placed).toBeGreaterThan(res.stats.demanded * 0.9);
  });
});

describe("generator: elective blocks", () => {
  const sections = ["a", "b", "c"].map((x, i) => ({ id: `s${x}`, label: `C-${x}`, classTeacherId: `ct${i}`, classId: "c1" }));
  const block = { id: "blk", classId: "c1", name: "Second language", count: 4, doubles: 1, options: [
    { id: "o1", teacherId: "bt1", roomId: null }, { id: "o2", teacherId: "bt2", roomId: "r1" }, { id: "o3", teacherId: "bt3", roomId: null },
  ] };
  const demands = (): GenDemand[] => sections.flatMap((s, i) => ["maths", "eng", "sci"].map((sub, j) => (
    { id: `${s.id}-${sub}`, sectionId: s.id, subjectId: sub, teacherId: `t${i}${j}`, count: j === 0 ? 8 : 6, doubles: 0, roomKind: null })));
  const input = (seed = 3, extra: Partial<GenInput> = {}): GenInput => ({ sections, days: DAYS, periods: PERIODS, demands: demands(), blocks: [block], rooms: [{ id: "r1", name: "Hall", kind: "hall" }], seed, ...extra });

  it("the block takes the same cells for every section, one teacher per option at a time, and fits beside compulsory subjects", () => {
    const inp = input();
    const res = generate(inp);
    assertSound(inp, res);
    expect(res.unplaced).toEqual([]);
    expect(res.blockPlacements).toHaveLength(4);
    const cells = new Set(res.blockPlacements.map((b) => `${b.day}|${b.periodId}`));
    expect(cells.size).toBe(4); // no cell twice
    for (const c of cells) {
      const [day, periodId] = c.split("|");
      // no ordinary class of any section sits in a block cell
      expect(res.placements.some((p) => p.day === Number(day) && p.periodId === periodId)).toBe(false);
    }
    // one double: two block periods back to back on one day
    const byDay = new Map<number, number[]>();
    for (const b of res.blockPlacements) byDay.set(b.day, [...(byDay.get(b.day) ?? []), PERIODS.findIndex((p) => p.id === b.periodId)]);
    expect([...byDay.values()].some((ix) => ix.length === 2 && Math.abs(ix[0]! - ix[1]!) === 1)).toBe(true);
    // every section: block 4 + compulsory 20 = 24 cells; compulsory placed in full
    expect(res.stats.placed).toBe(res.stats.demanded);
  });

  it("an option teacher's other classes never meet the block", () => {
    const clash = demands().map((d) => (d.id === "sa-maths" ? { ...d, teacherId: "bt2", count: 10 } : d));
    const inp = input(5, { demands: clash });
    const res = generate(inp);
    const busy = new Set(res.blockPlacements.map((b) => `${b.day}|${b.periodId}`));
    for (const p of res.placements) if (p.teacherId === "bt2") expect(busy.has(`${p.day}|${p.periodId}`)).toBe(false);
  });

  it("honours teacher unavailability and reports a block that cannot be placed, with the reason", () => {
    const all = DAYS.flatMap((day) => PERIODS.map((p) => ({ day, periodId: p.id })));
    const res = generate(input(1, { teacherRules: { bt3: { unavailable: all } } }));
    expect(res.blockPlacements).toHaveLength(0);
    expect(res.unplaced[0]).toMatchObject({ blockId: "blk", missing: 4 });
    expect(res.unplaced[0]!.reason).toMatch(/unavailable/);
  });

  it("locked block cells stay and count against the demand; teacher week caps apply", () => {
    const res = generate(input(2, { lockedBlocks: [{ blockId: "blk", day: 2, periodId: "p3" }], teacherRules: { bt1: { maxPerWeek: 3 } } }));
    expect(res.blockPlacements.find((b) => b.day === 2 && b.periodId === "p3")).toMatchObject({ locked: true });
    expect(res.blockPlacements).toHaveLength(3); // the cap of 3 stops the fourth
    expect(res.unplaced[0]).toMatchObject({ blockId: "blk", missing: 1 });
    expect(res.unplaced[0]!.reason).toMatch(/maximum/);
  });

  it("the same seed gives the same result", () => {
    const a = generate(input(11)), b = generate(input(11));
    expect(b.blockPlacements).toEqual(a.blockPlacements);
    expect(b.placements).toEqual(a.placements);
  });

  it("validation flags a teacher in two options of one block", () => {
    const bad = { ...block, options: [block.options[0]!, { ...block.options[1]!, teacherId: "bt1" }] };
    expect(validateInput(input(1, { blocks: [bad] })).some((i) => /two options/.test(i.message))).toBe(true);
  });
});
