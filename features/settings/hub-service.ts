import { and, auditLogs, count, desc, eq, gt, inArray, loginEvents, modules, plans, schools, sql, users } from "@smw/db";
import { accessState } from "./access-service";
import { dataExports } from "./schema";
import { DataService, memo } from "./data-base";
import { completeness, profileWarnings } from "./profile-meta";

export interface AttentionItem { key: string; text: string; href: string; tone: "warning" | "danger" | "info" }

/** What the Settings front page says needs a look, read from the data. Nothing here is a setting; each line leads to the page that fixes it. */
export class HubService extends DataService {
  async attention(): Promise<AttentionItem[]> {
    return this.read("manage", async (tx) => {
      const [school] = await tx.select().from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      // The two counts are read on every visit to Settings: kept for a minute.
      const [people, fails] = await memo(`hub:${this.ctx.schoolId}`, 60_000, () => Promise.all([
        tx.select({ status: users.status, role: users.role, noEmail: sql<boolean>`${users.email} is null`, n: count() }).from(users).groupBy(users.status, users.role, sql`${users.email} is null`),
        tx.select({ n: count() }).from(loginEvents).where(and(gt(loginEvents.createdAt, new Date(Date.now() - 86_400_000)), inArray(loginEvents.outcome, ["bad_password", "bad_code"]))),
      ]));
      const out: AttentionItem[] = [];
      const sum = (f: (p: (typeof people)[number]) => boolean) => people.filter(f).reduce((a, p) => a + Number(p.n), 0);
      const admins = sum((p) => p.role === "admin" && p.status === "active");
      if (admins === 1) out.push({ key: "one-admin", tone: "warning", text: "Only one person is an admin. Add a second so the school is never locked out.", href: "/app/settings/users" });
      const failed = Number(fails[0]?.n ?? 0);
      if (failed >= 5) out.push({ key: "failed", tone: failed >= 10 ? "danger" : "warning", text: `${failed} failed sign-in tries in the last 24 hours.`, href: "/app/settings/sign-ins?outcome=failed" });
      const invited = sum((p) => p.status === "invited");
      if (invited) out.push({ key: "invited", tone: "info", text: `${invited} ${invited === 1 ? "person has" : "people have"} not signed in yet. Send the invite again.`, href: "/app/settings/users?show=never" });
      const noEmail = sum((p) => p.noEmail && p.status === "active" && p.role !== "student" && p.role !== "parent");
      if (noEmail) out.push({ key: "no-email", tone: "info", text: `${noEmail} staff ${noEmail === 1 ? "login has" : "logins have"} no email, so ${noEmail === 1 ? "it" : "they"} cannot reset a password alone.`, href: "/app/settings/users?show=noemail" });
      if (school) {
        const c = completeness(school);
        if (c.missing.length) out.push({ key: "profile", tone: "info", text: `The school profile is missing ${c.missing.length} detail${c.missing.length === 1 ? "" : "s"}: ${c.missing.slice(0, 3).map((m) => m.label).join(", ")}${c.missing.length > 3 ? " and more" : ""}.`, href: `/app/settings/school#${c.missing[0]!.group}` });
        for (const w of profileWarnings(school)) out.push({ key: `warn-${w.field}`, tone: "warning", text: w.text, href: "/app/settings/school#tax" });
      }
      return out;
    });
  }
}

export interface HubFacts { plan: string | null; admins: number; modulesOn: number; lastExport: Date | null; support: "always" | "until" | "never"; supportOpen: boolean }

/** Useful numbers for the Settings front page, each one a link target. A fact that cannot be read comes back empty; it never breaks the page. */
export class HubFactsService extends DataService {
  async facts(): Promise<HubFacts> {
    return this.read("manage", async (tx) => {
      const [school] = await tx.select({ planId: schools.planId, a: schools.supportAccess, u: schools.supportAccessUntil }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      const [plan, admins, exp] = await Promise.all([
        school?.planId ? tx.select({ name: plans.name }).from(plans).where(eq(plans.id, school.planId)).limit(1).then((r) => r[0]?.name ?? null).catch(() => null) : null,
        tx.select({ n: count() }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"))).then((r) => Number(r[0]?.n ?? 0)),
        tx.select({ at: dataExports.finishedAt }).from(dataExports).where(eq(dataExports.status, "ready")).orderBy(desc(dataExports.finishedAt)).limit(1).then((r) => r[0]?.at ?? null),
      ]);
      const acc = school ? accessState({ supportAccess: school.a, supportAccessUntil: school.u }) : null;
      return { plan, admins, modulesOn: this.ctx.features.size, lastExport: exp, support: acc?.mode ?? "always", supportOpen: acc?.open ?? true };
    });
  }
}

export interface ModuleRow { key: string; name: string; description: string | null; stage: string; core: boolean; state: "core" | "used" | "unused" | "off"; lastUsed: Date | null }

/** Modules with where they stand for this school. "Used" is read from the audit log: a module counts once anything was ever saved in it. */
export class ModulesService extends DataService {
  async list(): Promise<ModuleRow[]> {
    return this.read("manage", async (tx) => {
      const [mods, used] = await Promise.all([
        tx.select().from(modules).orderBy(modules.name),
        // Last use per module: one lookup per module through the (school, module, time) index, kept for five minutes.
        memo(`modules:${this.ctx.schoolId}`, 300_000, async () => {
          const names = (await tx.execute<{ module: string }>(sql`
            with recursive t as (
              (select module from audit_logs where school_id = ${this.ctx.schoolId} order by module limit 1)
              union all
              select (select module from audit_logs where school_id = ${this.ctx.schoolId} and module > t.module order by module limit 1) from t where t.module is not null)
            select module from t where module is not null`)).map((r) => r.module);
          return Promise.all(names.map(async (m) => ({ module: m, last: (await tx.select({ last: sql<Date | null>`max(${auditLogs.createdAt})` }).from(auditLogs).where(eq(auditLogs.module, m)))[0]?.last ?? null })));
        }),
      ]);
      const last = new Map(used.map((u) => [u.module, u.last]));
      return mods.map((m): ModuleRow => {
        const at = last.get(m.key);
        const lastUsed = at ? new Date(at) : null;
        const on = this.ctx.features.has(m.key);
        return { key: m.key, name: m.name, description: m.description, stage: m.stage, core: m.core, lastUsed, state: !on ? "off" : m.core ? "core" : lastUsed ? "used" : "unused" };
      });
    });
  }
}
