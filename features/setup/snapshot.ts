import { inArray, modules, planModules, schoolModuleOverrides, schoolSetupStatus, schools, sql, withConsole, withSchool } from "@smw/db";
import { resolveEntitlements, systemCtx } from "@smw/feature-kit";
import { SetupService } from "./service";
import { SetupTaskService } from "./task-service";

const one = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => { try { return await run(); } catch { return fallback; } };

/** The picture of one school: how far getting started has come, the wizard's next step, who signed in last, the first attendance. Written through the console connection. */
export async function snapshotSchool(schoolId: string, features: Iterable<string>): Promise<"written" | "skipped"> {
  const ctx = systemCtx(schoolId, features);
  const [tasks, wizard] = await Promise.all([new SetupTaskService(ctx).progress(), new SetupService(ctx).progress()]);
  // A list that could not be read would make the percent look lower than it is: keep last night's picture and say so.
  if (tasks.unchecked > 0) {
    console.error(JSON.stringify({ level: "warn", msg: "setup.snapshot skipped: a checklist could not be read", schoolId, unchecked: tasks.unchecked }));
    return "skipped";
  }
  const facts = await withSchool(schoolId, async (tx) => {
    const [r] = [...(await tx.execute(sql`select (select max(last_login_at) from users) as last_login, (select count(*)::int from students where status = 'active') as students`))] as { last_login: Date | null; students: number }[];
    return r ?? { last_login: null, students: 0 };
  });
  // Attendance belongs to a module a school may not have, so its table may be missing.
  const first = await one(() => withSchool(schoolId, async (tx) => {
    const [r] = [...(await tx.execute(sql`select min(date)::text as d from student_attendance`))] as { d: string | null }[];
    return r?.d ?? null;
  }), null);
  const row = {
    percent: tasks.percent, done: tasks.done, total: tasks.total - tasks.skipped - tasks.unchecked,
    nextKey: tasks.next?.key ?? null, nextLabel: tasks.next?.label ?? null,
    lastLoginAt: facts.last_login ? new Date(facts.last_login) : null, students: Number(facts.students), firstAttendanceOn: first,
    facts: {
      wizardDone: wizard.doneCount, wizardTotal: wizard.total, wizardNext: wizard.next ? wizard.steps.find((s) => s.key === wizard.next)?.label ?? null : null,
      wizardFinished: !!wizard.completedAt, tasksSkipped: tasks.skipped, cardHidden: tasks.hidden,
    },
  };
  await withConsole((tx) => tx.insert(schoolSetupStatus).values({ schoolId, ...row })
    .onConflictDoUpdate({ target: schoolSetupStatus.schoolId, set: { ...row, updatedAt: new Date() } }));
  return "written";
}

/** Every active or trial school, one after the other. One school failing is logged and never stops the rest; the job fails at the end so it is retried. */
export async function snapshotAll(): Promise<{ done: number; failed: number }> {
  const { list, mods, plan, overrides } = await withConsole(async (tx) => {
    const list = await tx.select({ id: schools.id, status: schools.status, planId: schools.planId }).from(schools).where(inArray(schools.status, ["active", "trial"]));
    const [mods, plan, overrides] = await Promise.all([tx.select().from(modules), tx.select().from(planModules), tx.select().from(schoolModuleOverrides)]);
    return { list, mods, plan, overrides };
  });
  const info = mods.map((m) => ({ key: m.key, stage: m.stage, requires: m.requires, core: m.core }));
  let done = 0, failed = 0;
  for (const s of list) {
    try {
      const { enabled } = resolveEntitlements({
        status: s.status, modules: info, planModuleKeys: plan.filter((p) => p.planId === s.planId).map((p) => p.moduleKey), overrides: overrides.filter((o) => o.schoolId === s.id),
      });
      if ((await snapshotSchool(s.id, enabled)) === "written") done++;
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ level: "error", msg: "setup.snapshot failed", schoolId: s.id, err: String(err) }));
    }
  }
  if (failed) throw new Error(`setup.snapshot failed for ${failed} of ${list.length} schools`);
  return { done, failed };
}
