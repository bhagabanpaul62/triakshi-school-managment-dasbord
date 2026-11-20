// The timetable solver. Pure: no database, no clock except the time budget. Deterministic for a given seed.
// Greedy (most constrained demand first, doubles first), then repair by moving the one placement that blocks a cell.

export interface GenSection { id: string; label: string; classTeacherId: string | null; classId?: string }
/** An elective block: `count` periods a week at which EVERY section of the class sits together and each option's teacher (and fixed room) is busy. */
export interface GenBlock { id: string; classId: string; name: string; count: number; doubles: number; options: { id: string; teacherId: string; roomId: string | null }[] }
export interface GenBlockCell { blockId: string; day: number; periodId: string }
/** Non-break periods in day order. `afterBreak` = a break sits between this period and the one before it (so they are not back-to-back). */
export interface GenPeriod { id: string; name: string; afterBreak: boolean }
export interface GenDemand { id: string; sectionId: string; subjectId: string; teacherId: string | null; count: number; doubles: number; roomKind: string | null }
export interface GenTeacherRule { maxPerDay?: number | null; maxPerWeek?: number | null; unavailable?: { day: number; periodId: string }[] }
export interface GenRoom { id: string; name: string; kind: string }
export interface GenCell { sectionId: string; day: number; periodId: string; subjectId: string; teacherId: string | null; roomId?: string | null }
export interface GenInput {
  sections: GenSection[];
  days: number[];
  periods: GenPeriod[];
  demands: GenDemand[];
  teacherRules?: Record<string, GenTeacherRule>;
  rooms?: GenRoom[];
  locked?: GenCell[];
  blocks?: GenBlock[];
  /** Pinned block cells of the draft being re-run. */
  lockedBlocks?: GenBlockCell[];
  settings?: { classTeacherFirstPeriod?: boolean; noSameSubjectTwiceADay?: boolean };
  seed?: number;
  /** Milliseconds; default 20 000. */
  budgetMs?: number;
  names?: { subject?: Record<string, string>; teacher?: Record<string, string> };
}
export interface Placement extends GenCell { demandId: string | null; locked: boolean; /** Marks a cell held by an elective block (never moved by repair). */ blockId?: string }
export interface Unplaced { demandId: string; sectionId: string; subjectId: string; teacherId: string | null; missing: number; reason: string; /** Set when a whole elective block could not be placed. */ blockId?: string }
export interface GenResult {
  placements: Placement[];
  /** One entry per block period placed (locked ones included). */
  blockPlacements: (GenBlockCell & { locked: boolean })[];
  unplaced: Unplaced[];
  stats: { demanded: number; placed: number; unplaced: number; locked: number; repaired: number; ms: number; timedOut: boolean; seed: number };
}
export interface GenIssue { level: "error" | "warning"; message: string }

/** Small seeded RNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOFT_SAME_DAY = 100;

/** Problems visible before solving: a class asking for more periods than the week has, a teacher over their cap. */
export function validateInput(inp: GenInput): GenIssue[] {
  const issues: GenIssue[] = [];
  const week = inp.days.length * inp.periods.length;
  const tn = (id: string) => inp.names?.teacher?.[id] ?? "A teacher";
  const sn = (id: string) => inp.names?.subject?.[id] ?? "A subject";
  const secLabel = new Map(inp.sections.map((s) => [s.id, s.label]));
  const perSection = new Map<string, number>();
  const perTeacher = new Map<string, number>();
  for (const d of inp.demands) {
    perSection.set(d.sectionId, (perSection.get(d.sectionId) ?? 0) + d.count);
    if (d.teacherId) perTeacher.set(d.teacherId, (perTeacher.get(d.teacherId) ?? 0) + d.count);
    else issues.push({ level: "error", message: `${secLabel.get(d.sectionId) ?? "A section"} has no teacher for ${sn(d.subjectId)}. Assign one in the class page.` });
    if (d.doubles * 2 > d.count) issues.push({ level: "error", message: `${secLabel.get(d.sectionId) ?? "A section"}: ${sn(d.subjectId)} has ${d.doubles} double periods but only ${d.count} periods a week.` });
    if (inp.settings?.noSameSubjectTwiceADay !== false && d.count > inp.days.length && d.doubles === 0)
      issues.push({ level: "warning", message: `${secLabel.get(d.sectionId) ?? "A section"}: ${sn(d.subjectId)} has ${d.count} periods in ${inp.days.length} days, so it must repeat on a day.` });
  }
  const classOf = (c: string | undefined) => inp.sections.filter((s) => s.classId === c);
  for (const b of inp.blocks ?? []) {
    const secs = classOf(b.classId);
    for (const s of secs) perSection.set(s.id, (perSection.get(s.id) ?? 0) + b.count);
    const seen = new Set<string>();
    for (const o of b.options) {
      perTeacher.set(o.teacherId, (perTeacher.get(o.teacherId) ?? 0) + b.count);
      if (seen.has(o.teacherId)) issues.push({ level: "error", message: `${b.name}: ${tn(o.teacherId)} teaches two options at the same time.` });
      seen.add(o.teacherId);
    }
    if (b.doubles * 2 > b.count) issues.push({ level: "error", message: `${b.name} has ${b.doubles} double periods but only ${b.count} periods a week.` });
    if (!secs.length) issues.push({ level: "warning", message: `${b.name}: its class has no sections this year, so it will not be placed.` });
  }
  for (const [id, n] of perSection) if (n > week) issues.push({ level: "error", message: `${secLabel.get(id) ?? "A section"} needs ${n} periods but the week has ${week} slots.` });
  for (const [id, n] of perTeacher) {
    const r = inp.teacherRules?.[id];
    const blocked = new Set((r?.unavailable ?? []).map((u) => `${u.day}:${u.periodId}`)).size;
    const cap = Math.min(r?.maxPerWeek ?? week, (r?.maxPerDay ?? inp.periods.length) * inp.days.length, week - blocked);
    if (n > cap) issues.push({ level: "error", message: `${tn(id)} is asked for ${n} periods but can take at most ${cap}.` });
  }
  const kinds = new Set((inp.rooms ?? []).map((r) => r.kind));
  for (const d of inp.demands) if (d.roomKind && !kinds.has(d.roomKind))
    issues.push({ level: "error", message: `${secLabel.get(d.sectionId) ?? "A section"}: ${sn(d.subjectId)} needs a "${d.roomKind}" room but none is defined.` });
  return [...new Map(issues.map((i) => [i.message, i])).values()];
}

interface Unit { demand: GenDemand; size: 1 | 2; order: number }

export function generate(inp: GenInput): GenResult {
  const t0 = Date.now();
  const budget = inp.budgetMs ?? 20_000;
  const rand = rng(inp.seed ?? 1);
  const P = inp.periods;
  const idxOf = new Map(P.map((p, i) => [p.id, i]));
  const sec = new Map(inp.sections.map((s) => [s.id, s]));
  const rooms = inp.rooms ?? [];
  const roomsOfKind = (k: string) => rooms.filter((r) => r.kind === k);
  const rules = inp.teacherRules ?? {};
  const classTeacherFirst = inp.settings?.classTeacherFirstPeriod !== false;
  const noRepeat = inp.settings?.noSameSubjectTwiceADay !== false;

  const grid = new Map<string, Placement>(); // sec|day|idx
  const tBusy = new Map<string, Placement>(); // teacher|day|idx
  const rBusy = new Set<string>(); // room|day|idx
  const tDay = new Map<string, number>(); // teacher|day
  const tWeek = new Map<string, number>();
  const subDay = new Map<string, number>(); // sec|subject|day
  const unavail = new Map<string, Set<string>>();
  for (const [t, r] of Object.entries(rules)) unavail.set(t, new Set((r.unavailable ?? []).map((u) => `${u.day}|${idxOf.get(u.periodId)}`)));
  const g = (s: string, d: number, i: number) => `${s}|${d}|${i}`;
  const bump = (m: Map<string, number>, k: string, by: number) => m.set(k, (m.get(k) ?? 0) + by);

  const put = (c: GenCell & { demandId: string | null; locked: boolean }) => {
    const i = idxOf.get(c.periodId)!;
    const pl: Placement = { ...c };
    grid.set(g(c.sectionId, c.day, i), pl);
    if (c.teacherId) { tBusy.set(g(c.teacherId, c.day, i), pl); bump(tDay, `${c.teacherId}|${c.day}`, 1); bump(tWeek, c.teacherId, 1); }
    if (c.roomId) rBusy.add(g(c.roomId, c.day, i));
    bump(subDay, `${c.sectionId}|${c.subjectId}|${c.day}`, 1);
    return pl;
  };
  const take = (pl: Placement) => {
    const i = idxOf.get(pl.periodId)!;
    grid.delete(g(pl.sectionId, pl.day, i));
    if (pl.teacherId) { tBusy.delete(g(pl.teacherId, pl.day, i)); bump(tDay, `${pl.teacherId}|${pl.day}`, -1); bump(tWeek, pl.teacherId, -1); }
    if (pl.roomId) rBusy.delete(g(pl.roomId, pl.day, i));
    bump(subDay, `${pl.sectionId}|${pl.subjectId}|${pl.day}`, -1);
  };

  // Locked cells first. They also count against the demand they belong to.
  const remaining = new Map(inp.demands.map((d) => [d.id, d.count]));
  const unplaced: Unplaced[] = [];
  let locked = 0;
  for (const c of inp.locked ?? []) {
    const i = idxOf.get(c.periodId);
    if (i === undefined || !sec.has(c.sectionId)) continue;
    if (grid.has(g(c.sectionId, c.day, i)) || (c.teacherId && tBusy.has(g(c.teacherId, c.day, i)))) continue;
    put({ ...c, demandId: null, locked: true });
    locked++;
    const d = inp.demands.find((x) => x.sectionId === c.sectionId && x.subjectId === c.subjectId && (remaining.get(x.id) ?? 0) > 0);
    if (d) remaining.set(d.id, remaining.get(d.id)! - 1);
  }

  const cap = (t: string) => rules[t]?.maxPerWeek ?? Infinity;
  const capDay = (t: string) => rules[t]?.maxPerDay ?? Infinity;

  // ---- elective blocks: placed before ordinary demands, since one cell ties up every section, every option teacher and room at once ----
  const blocks = (inp.blocks ?? []).filter((b) => inp.sections.some((s) => s.classId === b.classId));
  const blockOut: (GenBlockCell & { locked: boolean })[] = [];
  const blockDay = new Map<string, number>(); // block|day
  const blockLeft = new Map(blocks.map((b) => [b.id, b.count]));
  const blockSecs = (b: GenBlock) => inp.sections.filter((s) => s.classId === b.classId);
  const blockWhy = new Map<string, Map<string, number>>();
  const blockFits = (b: GenBlock, size: 1 | 2, day: number, start: number): { ok: true } | { ok: false; why: string } => {
    if (start + size > P.length) return { ok: false, why: "shape" };
    if (size === 2 && P[start + 1]!.afterBreak) return { ok: false, why: "shape" };
    for (let k = 0; k < size; k++) {
      for (const s of blockSecs(b)) if (grid.has(g(s.id, day, start + k))) return { ok: false, why: "section" };
      for (const o of b.options) {
        if (unavail.get(o.teacherId)?.has(`${day}|${start + k}`)) return { ok: false, why: "unavailable" };
        if (tBusy.has(g(o.teacherId, day, start + k))) return { ok: false, why: "teacher" };
        if (o.roomId && rBusy.has(g(o.roomId, day, start + k))) return { ok: false, why: "room" };
      }
    }
    for (const o of b.options) {
      if ((tDay.get(`${o.teacherId}|${day}`) ?? 0) + size > capDay(o.teacherId)) return { ok: false, why: "limit" };
      if ((tWeek.get(o.teacherId) ?? 0) + size > cap(o.teacherId)) return { ok: false, why: "limit" };
    }
    return { ok: true };
  };
  const putBlock = (b: GenBlock, size: number, day: number, start: number, lockedCell: boolean) => {
    for (let k = 0; k < size; k++) {
      const i = start + k, periodId = P[i]!.id;
      for (const s of blockSecs(b)) grid.set(g(s.id, day, i), { sectionId: s.id, day, periodId, subjectId: "", teacherId: null, demandId: null, locked: true, blockId: b.id });
      for (const o of b.options) {
        tBusy.set(g(o.teacherId, day, i), { sectionId: "", day, periodId, subjectId: "", teacherId: o.teacherId, demandId: null, locked: true, blockId: b.id });
        bump(tDay, `${o.teacherId}|${day}`, 1); bump(tWeek, o.teacherId, 1);
        if (o.roomId) rBusy.add(g(o.roomId, day, i));
      }
      blockOut.push({ blockId: b.id, day, periodId, locked: lockedCell });
    }
    bump(blockDay, `${b.id}|${day}`, size);
  };
  let lockedBlockCells = 0;
  for (const c of inp.lockedBlocks ?? []) {
    const b = blocks.find((x) => x.id === c.blockId), i = idxOf.get(c.periodId);
    if (!b || i === undefined || blockFits(b, 1, c.day, i).ok === false) continue;
    putBlock(b, 1, c.day, i, true);
    lockedBlockCells++;
    blockLeft.set(b.id, (blockLeft.get(b.id) ?? 0) - 1);
  }
  const blockUnits: { b: GenBlock; size: 1 | 2; key: number[] }[] = [];
  for (const b of blocks) {
    const left = Math.max(0, blockLeft.get(b.id) ?? 0);
    const dbl = Math.min(b.doubles, Math.floor(left / 2));
    const tight = Math.min(...b.options.map((o) => inp.days.length * P.length - (unavail.get(o.teacherId)?.size ?? 0)));
    for (let i = 0; i < dbl; i++) blockUnits.push({ b, size: 2, key: [0, tight, rand()] });
    for (let i = 0; i < left - dbl * 2; i++) blockUnits.push({ b, size: 1, key: [1, tight, rand()] });
  }
  blockUnits.sort((x, y) => { for (let i = 0; i < 3; i++) if (x.key[i] !== y.key[i]) return x.key[i]! - y.key[i]!; return 0; });
  const blockMissing = new Map<string, number>();
  for (const { b, size } of blockUnits) {
    let pick: { day: number; start: number; c: number } | null = null;
    const why = blockWhy.get(b.id) ?? new Map<string, number>();
    for (const day of inp.days) for (let s = 0; s < P.length; s++) {
      const f = blockFits(b, size, day, s);
      if (!f.ok) { why.set(f.why, (why.get(f.why) ?? 0) + 1); continue; }
      // Spread over the week; a second period on the same day is allowed but costs.
      const c = rand() + (blockDay.get(`${b.id}|${day}`) ?? 0) * (noRepeat ? SOFT_SAME_DAY : 10) + b.options.reduce((n, o) => n + (tDay.get(`${o.teacherId}|${day}`) ?? 0), 0) * 0.5;
      if (!pick || c < pick.c) pick = { day, start: s, c };
    }
    blockWhy.set(b.id, why);
    if (pick) putBlock(b, size, pick.day, pick.start, false);
    else blockMissing.set(b.id, (blockMissing.get(b.id) ?? 0) + size);
  }
  const teacherSlotsLeft = (t: string) => inp.days.length * P.length - (unavail.get(t)?.size ?? 0);

  /** Hard-rule check for a unit at (day, start). Returns the room to use (or null), or a reason code when infeasible. */
  type Fit = { ok: true; roomId: string | null } | { ok: false; why: "section" | "teacher" | "unavailable" | "limit" | "room" | "shape" };
  const fits = (u: Unit, day: number, start: number): Fit => {
    const d = u.demand;
    if (start + u.size > P.length) return { ok: false, why: "shape" };
    if (u.size === 2 && P[start + 1]!.afterBreak) return { ok: false, why: "shape" };
    for (let k = 0; k < u.size; k++) {
      if (grid.has(g(d.sectionId, day, start + k))) return { ok: false, why: "section" };
    }
    if (d.teacherId) {
      for (let k = 0; k < u.size; k++) {
        if (unavail.get(d.teacherId)?.has(`${day}|${start + k}`)) return { ok: false, why: "unavailable" };
        if (tBusy.has(g(d.teacherId, day, start + k))) return { ok: false, why: "teacher" };
      }
      if ((tDay.get(`${d.teacherId}|${day}`) ?? 0) + u.size > capDay(d.teacherId)) return { ok: false, why: "limit" };
      if ((tWeek.get(d.teacherId) ?? 0) + u.size > cap(d.teacherId)) return { ok: false, why: "limit" };
    }
    let roomId: string | null = null;
    if (d.roomKind) {
      const pool = roomsOfKind(d.roomKind);
      const free = pool.filter((r) => { for (let k = 0; k < u.size; k++) { if (rBusy.has(g(r.id, day, start + k))) return false; } return true; });
      if (!free.length) return { ok: false, why: "room" };
      roomId = free[0]!.id;
    }
    return { ok: true, roomId };
  };

  const cost = (u: Unit, day: number, start: number) => {
    const d = u.demand;
    let c = rand();
    const same = subDay.get(`${d.sectionId}|${d.subjectId}|${day}`) ?? 0;
    if (same > 0) c += noRepeat ? SOFT_SAME_DAY * same : 10 * same;
    if (d.teacherId) c += (tDay.get(`${d.teacherId}|${day}`) ?? 0) * 2;
    // Spread: keep each section's days level.
    let load = 0; for (let i = 0; i < P.length; i++) if (grid.has(g(d.sectionId, day, i))) load++;
    c += load * 1.5;
    const ct = sec.get(d.sectionId)?.classTeacherId;
    if (classTeacherFirst && ct) {
      if (start === 0 && d.teacherId === ct) c -= 40;
      else if (start === 0 && d.teacherId !== ct) c += 15;
    }
    return c;
  };

  const place = (u: Unit, day: number, start: number, roomId: string | null) => {
    const d = u.demand;
    for (let k = 0; k < u.size; k++) put({ sectionId: d.sectionId, day, periodId: P[start + k]!.id, subjectId: d.subjectId, teacherId: d.teacherId, roomId, demandId: d.id, locked: false });
  };
  const best = (u: Unit) => {
    let pick: { day: number; start: number; roomId: string | null; c: number } | null = null;
    const why = new Map<string, number>();
    for (const day of inp.days) for (let s = 0; s < P.length; s++) {
      const f = fits(u, day, s);
      if (!f.ok) { why.set(f.why, (why.get(f.why) ?? 0) + 1); continue; }
      const c = cost(u, day, s);
      if (!pick || c < pick.c) pick = { day, start: s, roomId: f.roomId, c };
    }
    return { pick, why };
  };

  // Units: doubles first, then by how few cells the teacher has, then bigger demands.
  const units: Unit[] = [];
  inp.demands.forEach((d, n) => {
    const left = remaining.get(d.id) ?? 0;
    const dbl = Math.min(d.doubles, Math.floor(left / 2));
    for (let i = 0; i < dbl; i++) units.push({ demand: d, size: 2, order: n });
    for (let i = 0; i < left - dbl * 2; i++) units.push({ demand: d, size: 1, order: n });
  });
  const keyOf = (u: Unit) => [u.size === 2 ? 0 : 1, u.demand.teacherId ? teacherSlotsLeft(u.demand.teacherId) : 0, u.demand.roomKind ? 0 : 1, -u.demand.count, rand()];
  const keyed = units.map((u) => ({ u, k: keyOf(u) }));
  keyed.sort((a, b) => { for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i]! - b.k[i]!; return 0; });

  const missing = new Map<string, { n: number; why: Map<string, number>; timeout: boolean }>();
  let repaired = 0;
  let timedOut = false;

  /** Try to make room for `u` by moving the single placement that blocks one cell somewhere else. */
  const repair = (u: Unit): boolean => {
    for (const day of inp.days) for (let s = 0; s < P.length; s++) {
      if (Date.now() - t0 > budget) return false;
      const blockers = new Set<Placement>();
      const d = u.demand;
      for (let k = 0; k < u.size && s + k < P.length; k++) {
        const a = grid.get(g(d.sectionId, day, s + k)); if (a) blockers.add(a);
        const b = d.teacherId ? tBusy.get(g(d.teacherId, day, s + k)) : undefined; if (b) blockers.add(b);
      }
      if (blockers.size !== 1) continue;
      const [b] = blockers as unknown as [Placement];
      if (b.locked) continue;
      const bi = idxOf.get(b.periodId)!;
      // A blocker that is half of a double stays put.
      const sibling = grid.get(g(b.sectionId, b.day, bi - 1)) ?? grid.get(g(b.sectionId, b.day, bi + 1));
      if (sibling && sibling.demandId === b.demandId && sibling.subjectId === b.subjectId && sibling.teacherId === b.teacherId && b.demandId && inp.demands.find((x) => x.id === b.demandId)!.doubles > 0) continue;
      const bd = inp.demands.find((x) => x.id === b.demandId);
      if (!bd) continue;
      take(b);
      const fit = fits(u, day, s);
      if (!fit.ok) { put(b); continue; }
      place(u, day, s, fit.roomId);
      const bu: Unit = { demand: bd, size: 1, order: 0 };
      const { pick } = best(bu);
      if (pick) { place(bu, pick.day, pick.start, pick.roomId); repaired++; return true; }
      // undo: remove the unit we just placed and restore the blocker
      for (let k = 0; k < u.size; k++) take(grid.get(g(d.sectionId, day, s + k))!);
      put(b);
    }
    return false;
  };

  for (const { u } of keyed) {
    if (Date.now() - t0 > budget) { timedOut = true; }
    const note = (why: Map<string, number>) => {
      const m = missing.get(u.demand.id) ?? { n: 0, why: new Map(), timeout: false };
      m.n += u.size; m.timeout ||= timedOut;
      for (const [k, v] of why) m.why.set(k, (m.why.get(k) ?? 0) + v);
      missing.set(u.demand.id, m);
    };
    if (timedOut || !u.demand.teacherId) { note(new Map()); continue; }
    const { pick, why } = best(u);
    if (pick) { place(u, pick.day, pick.start, pick.roomId); continue; }
    if (repair(u)) continue;
    note(why);
  }

  const tn = (id: string | null) => (id ? inp.names?.teacher?.[id] ?? "The teacher" : "No teacher");
  const sn = (id: string) => inp.names?.subject?.[id] ?? "the subject";
  for (const [id, m] of missing) {
    const d = inp.demands.find((x) => x.id === id)!;
    const top = ["limit", "unavailable", "room", "teacher", "shape", "section"].find((k) => m.why.has(k));
    const reason = m.timeout && !top ? "The time budget ran out before this was placed."
      : !d.teacherId ? "No teacher is assigned for this subject."
      : top === "limit" ? `${tn(d.teacherId)} has reached the maximum periods allowed per day or week.`
      : top === "unavailable" ? `${tn(d.teacherId)} is unavailable in every free period of this section.`
      : top === "teacher" ? `${tn(d.teacherId)} is already teaching other sections in every free period of this section.`
      : top === "room" ? `Every ${d.roomKind} room is booked in the periods this section has free.`
      : top === "shape" ? `No two back-to-back free periods are left for the double period of ${sn(d.subjectId)}.`
      : `This section has no free period left for ${sn(d.subjectId)}.`;
    unplaced.push({ demandId: id, sectionId: d.sectionId, subjectId: d.subjectId, teacherId: d.teacherId, missing: m.n, reason });
  }

  const placements = [...grid.values()].filter((p) => !p.blockId).sort((a, b) => a.sectionId.localeCompare(b.sectionId) || a.day - b.day || idxOf.get(a.periodId)! - idxOf.get(b.periodId)!);
  const bn = (id: string) => blocks.find((x) => x.id === id)!;
  for (const [id, n] of blockMissing) {
    const b = bn(id), why = blockWhy.get(id)!;
    const top = ["limit", "unavailable", "room", "teacher", "section", "shape"].find((k) => why.has(k));
    const names = b.options.map((o) => tn(o.teacherId)).join(", ");
    const reason = top === "limit" ? `A teacher of ${b.name} (${names}) has reached the maximum periods allowed per day or week.`
      : top === "unavailable" ? `A teacher of ${b.name} (${names}) is unavailable whenever the whole class is free.`
      : top === "room" ? `A fixed room of ${b.name} is booked whenever the whole class is free.`
      : top === "teacher" ? `The teachers of ${b.name} (${names}) are never all free in the same period.`
      : top === "shape" ? `No two back-to-back free periods are left for a double period of ${b.name}.`
      : `No period is free for every section of the class at once.`;
    unplaced.push({ demandId: `block:${id}`, blockId: id, sectionId: "", subjectId: "", teacherId: null, missing: n, reason });
  }
  const demanded = inp.demands.reduce((n, d) => n + d.count, 0) + blocks.reduce((n, b) => n + b.count, 0);
  const lost = unplaced.reduce((n, u) => n + u.missing, 0);
  return { placements, blockPlacements: blockOut, unplaced, stats: { demanded, placed: demanded - lost, unplaced: lost, locked: locked + lockedBlockCells, repaired, ms: Date.now() - t0, timedOut, seed: inp.seed ?? 1 } };
}
