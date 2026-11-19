import type { ModuleStage, SchoolStatus } from "@smw/db";

export interface ModuleInfo { key: string; stage: ModuleStage; requires: readonly string[]; core: boolean }
export interface Override { moduleKey: string; enabled: boolean; expiresAt: Date | null }

/** What a suspended or cancelled school keeps: paying and taking its data out. */
export const SUSPENDED_MODULES = ["billing", "settings"] as const;

export interface Entitlements { enabled: Set<string>; readOnly: boolean }

/**
 * Which modules one school has (spec §11), in this order:
 * suspended → billing + settings only; read_only → everything it had, no writes;
 * an unexpired override wins; else core modules, or `ga` modules in the plan; finally drop modules whose requirements are off.
 */
export function resolveEntitlements(input: {
  status: SchoolStatus;
  modules: readonly ModuleInfo[];
  planModuleKeys: readonly string[];
  overrides: readonly Override[];
  now?: Date;
}): Entitlements {
  const now = input.now ?? new Date();
  // Awaiting platform approval (or rejected): no modules at all; the panel shows a waiting screen.
  if (input.status === "pending" || input.status === "rejected") return { enabled: new Set(), readOnly: true };
  if (input.status === "suspended" || input.status === "cancelled") {
    return { enabled: new Set(SUSPENDED_MODULES.filter((k) => input.modules.some((m) => m.key === k))), readOnly: true };
  }
  const plan = new Set(input.planModuleKeys);
  const overrides = new Map(input.overrides.filter((o) => !o.expiresAt || o.expiresAt > now).map((o) => [o.moduleKey, o.enabled]));
  const enabled = new Set<string>();
  for (const m of input.modules) {
    const forced = overrides.get(m.key);
    if (forced !== undefined ? forced : m.core || (m.stage === "ga" && plan.has(m.key))) enabled.add(m.key);
  }
  // Remove modules whose requirements are off, until nothing changes (requirements can chain).
  const byKey = new Map(input.modules.map((m) => [m.key, m]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of enabled) {
      if (byKey.get(key)!.requires.some((r) => !enabled.has(r))) { enabled.delete(key); changed = true; }
    }
  }
  return { enabled, readOnly: input.status === "read_only" };
}
