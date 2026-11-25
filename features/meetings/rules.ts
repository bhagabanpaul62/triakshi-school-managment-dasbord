// Pure rules (no database, no framework): India time, slot grids and what a window change does to existing slots.
import type { SlotState } from "./constants";

const MINUTE = 60_000;

/** "2026-12-05" + "10:30" in India time. */
export const atIst = (day: string, hm: string) => new Date(`${day}T${hm}:00+05:30`);
export { istDay, istHm, parseIstInput, toIstInput } from "@smw/feature-kit/words";

export interface Span { startsAt: Date; endsAt: Date }
export interface Cell extends Span { state: "open" | "break" }
export interface Existing extends Span { id: string; state: SlotState; studentId: string | null }

const overlaps = (a: Span, b: Span) => a.startsAt < b.endsAt && a.endsAt > b.startsAt;

/** Back-to-back slots of `minutes` from the window start; a slot that touches a break is a break. A last part shorter than a slot is not used. */
export function buildGrid(window: Span, minutes: number, breaks: Span[] = []): Cell[] {
  const out: Cell[] = [];
  for (let at = window.startsAt.getTime(); at + minutes * MINUTE <= window.endsAt.getTime(); at += minutes * MINUTE) {
    const cell = { startsAt: new Date(at), endsAt: new Date(at + minutes * MINUTE) };
    out.push({ ...cell, state: breaks.some((b) => overlaps(cell, b)) ? "break" : "open" });
  }
  return out;
}

/** The breaks a window already has: its break slots, joined when they touch. */
export function breaksOf(slots: Existing[]): Span[] {
  const out: Span[] = [];
  for (const s of slots.filter((x) => x.state === "break").sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const last = out[out.length - 1];
    if (last && last.endsAt.getTime() === s.startsAt.getTime()) last.endsAt = s.endsAt;
    else out.push({ startsAt: s.startsAt, endsAt: s.endsAt });
  }
  return out;
}

export interface Plan {
  insert: Cell[];
  /** Free slots that no longer fit the window. */
  remove: string[];
  toBreak: string[];
  toOpen: string[];
  /** Booked slots that no longer fit: their families must be told. */
  drop: Existing[];
}

/** What to do with a window's existing slots so they match the new grid. Pure, so the preview and the change use the same answer. */
export function reconcile(grid: Cell[], existing: Existing[]): Plan {
  const live = existing.filter((e) => e.state !== "removed");
  const key = (s: Span) => `${s.startsAt.getTime()}-${s.endsAt.getTime()}`;
  const byKey = new Map(live.map((e) => [key(e), e]));
  const plan: Plan = { insert: [], remove: [], toBreak: [], toOpen: [], drop: [] };
  const used = new Set<string>();
  for (const cell of grid) {
    const ex = byKey.get(key(cell));
    if (!ex) { plan.insert.push(cell); continue; }
    used.add(ex.id);
    if (ex.state === "booked") {
      if (cell.state === "break") { plan.drop.push(ex); plan.insert.push(cell); }
    } else if (cell.state === "break" && ex.state === "open") plan.toBreak.push(ex.id);
    else if (cell.state === "open" && ex.state === "break") plan.toOpen.push(ex.id);
  }
  for (const ex of live) {
    if (used.has(ex.id)) continue;
    if (ex.state === "booked") plan.drop.push(ex);
    else plan.remove.push(ex.id);
  }
  return plan;
}

/** The slot a walk-in sits in: the teacher's window that holds `now`, else null. */
export const within = (span: Span, at: Date) => span.startsAt <= at && at < span.endsAt;
