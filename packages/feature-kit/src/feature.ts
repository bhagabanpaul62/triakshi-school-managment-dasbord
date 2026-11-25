import type { ModuleStage, SchoolRole } from "@smw/db";

/** Icon names the panel shell knows how to draw (mapped to Tabler icons in @smw/ui/shell). */
export type MenuIcon =
  | "home" | "users" | "user" | "teacher" | "parent" | "class" | "subject" | "calendar" | "clock" | "check"
  | "money" | "receipt" | "exam" | "result" | "book" | "assignment" | "megaphone" | "event" | "message"
  | "settings" | "billing" | "web" | "palette" | "globe" | "bus" | "library" | "bell" | "inbox" | "chart"
  | "shield" | "upload" | "support" | "report" | "domain" | "id";

export type MenuGroup = "main" | "academics" | "people" | "finance" | "communication" | "website" | "admin";

export interface MenuItem<P extends string> {
  label: string;
  href: string; // under /app
  icon: MenuIcon;
  permission: P;
  /** The item also shows for anyone holding one of these (a role that may edit sees the screens it edits). */
  also?: readonly P[];
  group?: MenuGroup;
  order?: number;
}

export interface FeatureDef<P extends string = string> {
  key: string;
  name: string;
  description: string;
  stage: ModuleStage;
  /** Always on (subject to suspension), never sold separately: dashboard, settings, billing. */
  core?: boolean;
  requires?: readonly string[];
  /** Which roles may do each action. Services check these; the menu shows items the role may read. */
  permissions: Record<P, readonly SchoolRole[]>;
  menu?: readonly MenuItem<NoInfer<P>>[];
}

/** Declare a feature. Keeps the permission names typed for its services. */
export function defineFeature<const P extends string>(def: FeatureDef<P>): FeatureDef<P> {
  return def;
}

export type PermissionOf<F> = F extends FeatureDef<infer P> ? P : never;

/**
 * Demo data for one school, default-exported from a feature's seed.ts. Seeds run in dependency order;
 * `state` carries ids between them (e.g. academics puts `classes`, students reads them).
 */
export type FeatureSeed = (ctx: import("./context").Ctx, state: Record<string, unknown>) => Promise<void>;

/** Order features so every feature comes after the ones it requires. Throws on a cycle or a missing requirement. */
export function orderFeatures<T extends { key: string; requires?: readonly string[] }>(features: readonly T[]): T[] {
  const byKey = new Map(features.map((f) => [f.key, f]));
  const out: T[] = [], state = new Map<string, "visiting" | "done">();
  const visit = (f: T) => {
    if (state.get(f.key) === "done") return;
    if (state.get(f.key) === "visiting") throw new Error(`Feature cycle at ${f.key}`);
    state.set(f.key, "visiting");
    for (const r of f.requires ?? []) {
      const dep = byKey.get(r);
      if (!dep) throw new Error(`${f.key} requires unknown feature ${r}`);
      visit(dep);
    }
    state.set(f.key, "done");
    out.push(f);
  };
  [...features].sort((a, b) => a.key.localeCompare(b.key)).forEach(visit);
  return out;
}
