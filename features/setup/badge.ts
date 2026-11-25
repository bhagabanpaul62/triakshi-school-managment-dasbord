// The sidebar's setup entries: for an admin, how many tasks are left ("Getting started"); for anyone else, how many tasks were given to them.
// Counting needs the full picture, so the answer is kept for a minute per person (failures and slow answers too); a change the admin makes forgets it at once.
import type { Ctx } from "@smw/feature-kit";

const KEEP_MS = 60_000;
/** The menu never waits longer than this for the count. */
export const BADGE_TIMEOUT_MS = 1_000;
export interface SetupBadges { left: number; mine: number }
const NONE: SetupBadges = { left: 0, mine: 0 };
const kept = new Map<string, { v: SetupBadges; at: number }>();

export const forgetBadge = (schoolId: string) => { for (const k of kept.keys()) if (k.startsWith(`${schoolId}:`)) kept.delete(k); };

async function count(ctx: Ctx): Promise<SetupBadges> {
  const { SetupTaskService } = await import("./task-service");
  const svc = new SetupTaskService(ctx);
  if (svc.can("run")) { const p = await svc.progress(); return { left: p.hidden ? 0 : p.left, mine: 0 }; }
  if (svc.can("task")) return { left: 0, mine: (await svc.mine()).length };
  return NONE;
}

/** Counts for the menu. Never throws and never waits more than a second: a failure or a slow count is remembered as "nothing" for the minute, and the real answer replaces it when it arrives. */
export async function setupBadges(ctx: Ctx): Promise<SetupBadges> {
  if (ctx.supportStaffId || !ctx.features.has("setup")) return NONE;
  const key = `${ctx.schoolId}:${ctx.userId}`;
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.v;
  const work = count(ctx).then((v) => { kept.set(key, { v, at: Date.now() }); return v; });
  work.catch(() => kept.set(key, { v: NONE, at: Date.now() }));
  const slow = new Promise<SetupBadges>((resolve) => setTimeout(() => { if (!kept.has(key)) kept.set(key, { v: NONE, at: Date.now() }); resolve(NONE); }, BADGE_TIMEOUT_MS).unref?.());
  return Promise.race([work, slow]).catch(() => NONE);
}
