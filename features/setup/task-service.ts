import { and, eq, inArray, schoolRoles, schools, sql, users, withSchool, type SchoolRole, type Tx } from "@smw/db";
import { DISCLOSURE_ROWS, disclosureFilled, disclosureSchema } from "@smw/site-templates";
import { ConflictError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { SetupService as FeesChecklist } from "@smw/feature-fees/setup-status";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { forgetBadge } from "./badge";
import { communicationSteps } from "./communication";
import setupFeature from "./feature";
import { assignTaskInput, skipTaskInput, taskKeyInput } from "./inputs";
import { CARD_KEY, setupTasks } from "./schema";
import { TASKS, TASK_GROUPS, canDoTask, percentOf, type TaskDef, type TaskGroup } from "./tasks";

type Perm = keyof typeof setupFeature.permissions;
type Row = typeof setupTasks.$inferSelect;

export interface TaskView {
  key: string; group: TaskGroup; label: string; why: string; minutes: number; href: string;
  needs: string; roles: readonly SchoolRole[];
  /** `unchecked`: the module's own list could not be read right now, so nobody knows. It is left out of the count. */
  state: "done" | "todo" | "skipped" | "unchecked";
  skipReason: string | null; skippedAt: Date | null;
  assignee: { id: string; name: string } | null;
  assignedBy: string | null; assignedAt: Date | null;
}
export interface TaskGroupView { key: TaskGroup; label: string; tasks: TaskView[]; done: number; open: number }
export interface TaskProgress {
  groups: TaskGroupView[];
  total: number; done: number; skipped: number;
  /** Tasks that could not be checked just now (left out of the percent). */
  unchecked: number;
  /** The school is read-only: the page shows what is done and changes nothing. */
  readOnly: boolean;
  /** Tasks still to do: not done and not skipped. */
  left: number;
  percent: number;
  next: TaskView | null;
  /** The home card is hidden for the whole school. */
  hidden: boolean;
  complete: boolean;
}
export interface Person { id: string; name: string; role: SchoolRole; roleName: string | null; grants: string[] | null }
export interface MyTask { key: string; label: string; why: string; minutes: number; href: string; assignedBy: string | null; assignedAt: Date | null; canDo: boolean }

/** Tables that exist, remembered for the life of the process: a table never goes away, and a missing one is asked again next time. */
const present = new Set<string>();
async function tablesPresent(tx: Tx, names: string[]): Promise<Set<string>> {
  const ask = names.filter((n) => !present.has(n));
  if (ask.length) {
    const rows = [...(await tx.execute(sql`select t from (values ${sql.join(ask.map((n) => sql`(${n}::text)`), sql`, `)}) as v(t) where to_regclass('public.' || t) is not null`))] as { t: string }[];
    for (const r of rows) present.add(r.t);
  }
  return new Set(names.filter((n) => present.has(n)));
}

/**
 * Getting started: every task of every module the school has, with its state read from the data.
 * What people decided (given to a colleague, skipped with a reason, the card hidden) is in `setup_tasks`.
 */
export class SetupTaskService extends SchoolService<Perm> {
  protected feature = setupFeature;
  constructor(ctx: Ctx) { super(ctx); }

  private on(key: string) { return this.ctx.features.has(key); }
  /** The tasks of the modules this school has. */
  private defs(keys?: readonly string[]): TaskDef[] { return TASKS.filter((t) => this.on(t.module) && (!keys || keys.includes(t.key))); }

  // ---------- done, from the data ----------

  /** One statement for every SQL task (cheap EXISTS), plus the modules' own lists for the tasks that read from them. `unchecked` holds the tasks whose list could not be read. */
  private async evaluate(tx: Tx, defs: TaskDef[]): Promise<{ done: Map<string, boolean>; unchecked: Set<string> }> {
    const done = new Map<string, boolean>();
    const withSql = defs.filter((d) => d.done);
    const have = await tablesPresent(tx, [...new Set(withSql.flatMap((d) => d.tables ?? []))]);
    const runnable = withSql.filter((d) => (d.tables ?? []).every((t) => have.has(t)));
    const [row] = runnable.length
      ? ([...(await tx.execute(sql`select ${sql.join(runnable.map((d, i) => sql`coalesce(${d.done}, false) as ${sql.identifier(`t${i}`)}`), sql`, `)}`))] as Record<string, unknown>[])
      : [];
    runnable.forEach((d, i) => done.set(d.key, row?.[`t${i}`] === true));
    const src = await this.sources(defs);
    const unchecked = new Set<string>();
    for (const d of defs) {
      if (!d.source) continue;
      if (src.failed.has(d.source.split(":")[0]!)) unchecked.add(d.key);
      else done.set(d.key, src.done.get(d.source) === true);
    }
    return { done, unchecked };
  }

  /** Fees', communication's and the website disclosure's own lists. One that cannot be read is named in `failed`: its tasks are unknown, not "not done". */
  private async sources(defs: TaskDef[]): Promise<{ done: Map<string, boolean>; failed: Set<string> }> {
    const done = new Map<string, boolean>();
    const failed = new Set<string>();
    const wants = (p: string) => defs.some((d) => d.source?.startsWith(`${p}:`));
    const run = (p: string, job: () => Promise<void>) => (wants(p) ? job().catch(() => { failed.add(p); }) : null);
    await Promise.all([
      run("fees", () => new FeesChecklist(this.ctx).status().then((s) => s.steps.forEach((x) => done.set(`fees:${x.key}`, x.done)))),
      run("comm", () => withSchool(this.ctx.schoolId, (tx) => communicationSteps(tx, (f) => this.on(f))).then((s) => s.forEach((x) => done.set(`comm:${x.key}`, x.done)))),
      run("site", () => withSchool(this.ctx.schoolId, async (tx) => {
        // The disclosure's own rule: every row filled in (or marked not applicable), with the school's profile filling what it can.
        if (!(await tablesPresent(tx, ["site_disclosure"])).size) return void done.set("site:disclosure", false);
        const [d] = [...(await tx.execute(sql`select data from site_disclosure limit 1`))] as { data: unknown }[];
        const [p] = await tx.select({ name: schools.name, affiliationNo: schools.affiliationNo, schoolCode: schools.schoolCode, address: schools.address, head: schools.headName, email: schools.email, phone: schools.phone }).from(schools).limit(1);
        const data = disclosureSchema.parse(d?.data ?? {});
        done.set("site:disclosure", !!d && DISCLOSURE_ROWS.every((r) => disclosureFilled(r, data, p ?? {})));
      })),
    ]);
    return { done, failed };
  }

  private async isDone(def: TaskDef): Promise<boolean> {
    return withSchool(this.ctx.schoolId, async (tx) => (await this.evaluate(tx, [def])).done.get(def.key) === true);
  }

  private async rows(tx: Tx): Promise<Map<string, Row>> {
    return new Map((await tx.select().from(setupTasks)).map((r) => [r.key, r]));
  }

  // ---------- progress ----------

  async progress(): Promise<TaskProgress> {
    this.authorize("run", "read");
    const defs = this.defs();
    const { done, unchecked, rows, names } = await withSchool(this.ctx.schoolId, async (tx) => {
      const [{ done, unchecked }, rows] = await Promise.all([this.evaluate(tx, defs), this.rows(tx)]);
      const ids = [...new Set([...rows.values()].flatMap((r) => [r.assignedTo, r.assignedBy]).filter((x): x is string => !!x))];
      const names = new Map(ids.length ? (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : []);
      return { done, unchecked, rows, names };
    });
    // A task the data says is done no longer waits on anyone: close what was given out for it.
    await this.closeDone(defs.filter((d) => done.get(d.key) && rows.get(d.key)?.assignedTo).map((d) => rows.get(d.key)!));

    const views = defs.map((d): TaskView => {
      const r = rows.get(d.key);
      const isDone = done.get(d.key) === true;
      return {
        key: d.key, group: d.group, label: d.label, why: d.why, minutes: d.minutes, href: d.href, needs: d.needs, roles: d.roles,
        state: isDone ? "done" : r?.skippedAt ? "skipped" : unchecked.has(d.key) ? "unchecked" : "todo",
        skipReason: !isDone && r?.skippedAt ? r.skipReason : null, skippedAt: !isDone ? r?.skippedAt ?? null : null,
        assignee: !isDone && r?.assignedTo ? { id: r.assignedTo, name: names.get(r.assignedTo) ?? "Someone who has left" } : null,
        assignedBy: r?.assignedBy ? names.get(r.assignedBy) ?? null : null, assignedAt: r?.assignedAt ?? null,
      };
    });
    const groups = TASK_GROUPS.map((g): TaskGroupView => {
      const tasks = views.filter((v) => v.group === g.key);
      return { key: g.key, label: g.label, tasks, done: tasks.filter((t) => t.state === "done").length, open: tasks.filter((t) => t.state === "todo").length };
    }).filter((g) => g.tasks.length);
    const count = (st: TaskView["state"]) => views.filter((v) => v.state === st).length;
    const doneN = count("done"), skipped = count("skipped"), unknown = count("unchecked");
    const left = count("todo");
    return {
      groups, total: views.length, done: doneN, skipped, unchecked: unknown, readOnly: this.ctx.readOnly, left, percent: percentOf(doneN, views.length, skipped + unknown),
      next: views.find((v) => v.state === "todo") ?? null, hidden: !!rows.get(CARD_KEY)?.skippedAt, complete: left === 0 && unknown === 0,
    };
  }

  /** What the home card needs, or null when it should not show: not an admin, hidden for the school, or everything is done. */
  async card(): Promise<{ percent: number; left: number; next: { label: string; href: string; minutes: number } | null } | null> {
    if (!this.can("run")) return null;
    const p = await this.progress();
    if (p.hidden || p.complete) return null;
    return { percent: p.percent, left: p.left, next: p.next && { label: p.next.label, href: p.next.href, minutes: p.next.minutes } };
  }

  /** People a task can be given to: staff logins that are active. `grants` is null for a built-in role. */
  async people(): Promise<Person[]> {
    return this.read("run", async (tx) => (await tx.select({ id: users.id, name: users.name, role: users.role, roleName: schoolRoles.name, grants: schoolRoles.grants })
      .from(users).leftJoin(schoolRoles, eq(schoolRoles.id, users.roleId))
      .where(and(eq(users.status, "active"), inArray(users.role, ["admin", "accountant", "teacher", "staff"]))).orderBy(users.name))
      .map((u) => ({ id: u.id, name: u.name, role: u.role, roleName: u.roleName, grants: u.roleName === null ? null : u.grants })));
  }

  // ---------- what people decide ----------

  private def(key: string): TaskDef {
    const d = TASKS.find((t) => t.key === key);
    if (!d || !this.on(d.module)) throw new NotFoundError("Task");
    return d;
  }

  private async close(tx: Tx, row: Pick<Row, "id" | "assignedTo">) {
    await NotificationWriter.done(tx, this.ctx.schoolId, { type: "setup_task", id: row.id }, row.assignedTo ?? undefined);
  }

  private async closeDone(rows: Row[]) {
    if (!rows.length || this.ctx.readOnly) return;
    // Closing the notice and clearing who it was given to go together, so the next look has nothing left to rewrite.
    await withSchool(this.ctx.schoolId, async (tx) => {
      for (const r of rows) {
        await this.close(tx, r);
        await tx.update(setupTasks).set({ assignedTo: null, updatedAt: new Date() }).where(eq(setupTasks.id, r.id));
      }
    }).catch(() => {});
  }

  /** Give a task to a colleague. They get it as something to do; giving it again moves it and closes the first one. */
  async assign(input: unknown): Promise<{ key: string; userId: string; name: string; warning: string | null }> {
    this.authorize("run", "write");
    const d = this.parse(assignTaskInput, input);
    const def = this.def(d.key);
    if (await this.isDone(def)) throw new ConflictError("That task is already done.");
    const out = await this.write("run", async (tx) => {
      const [p] = await tx.select({ id: users.id, name: users.name, role: users.role, roleName: schoolRoles.name, grants: schoolRoles.grants }).from(users)
        .leftJoin(schoolRoles, eq(schoolRoles.id, users.roleId))
        .where(and(eq(users.id, d.userId), eq(users.status, "active"), inArray(users.role, ["admin", "accountant", "teacher", "staff"]))).limit(1);
      if (!p) throw new ValidationError({ userId: "Pick one of your staff" });
      const [before] = await tx.select().from(setupTasks).where(eq(setupTasks.key, def.key)).for("update");
      const now = new Date();
      const [row] = await tx.insert(setupTasks).values({ schoolId: this.ctx.schoolId, key: def.key, assignedTo: p.id, assignedBy: this.ctx.userId, assignedAt: now })
        .onConflictDoUpdate({ target: [setupTasks.schoolId, setupTasks.key], set: { assignedTo: p.id, assignedBy: this.ctx.userId, assignedAt: now, skippedAt: null, skippedBy: null, skipReason: null, updatedAt: now } }).returning();
      if (before?.assignedTo && before.assignedTo !== p.id) await this.close(tx, before);
      await NotificationWriter.insert(tx, this.ctx.schoolId, [{
        userId: p.id, topic: "setup.task", title: `${this.ctx.name} gave you a setup task`, body: `${def.label}. ${def.why}`,
        href: "/app/getting-started?mine=1", subject: { type: "setup_task", id: row!.id }, groupKey: `setup.task:${def.key}`, action: true,
      }]);
      const can = canDoTask(def, { role: p.role, grants: p.roleName === null ? null : p.grants });
      return { key: def.key, userId: p.id, name: p.name, warning: can ? null : `${p.name}'s role cannot open this page yet. Change their role, or give the task to someone else.` };
    }, (r) => ({ action: "assign", entity: "Setup task", entityId: def.key, summary: `Gave "${def.label}" to ${r.name}` }));
    forgetBadge(this.ctx.schoolId);
    return out;
  }

  /** Take a task back from whoever has it. */
  async unassign(input: unknown): Promise<void> {
    const { key } = this.parse(taskKeyInput, input);
    const def = this.def(key);
    await this.write("run", async (tx) => {
      const [row] = await tx.select().from(setupTasks).where(eq(setupTasks.key, def.key)).for("update");
      if (!row?.assignedTo) return;
      await tx.update(setupTasks).set({ assignedTo: null, assignedBy: null, assignedAt: null, updatedAt: new Date() }).where(eq(setupTasks.id, row.id));
      await this.close(tx, row);
    }, () => ({ action: "unassign", entity: "Setup task", entityId: def.key, summary: `Took back "${def.label}"` }));
    forgetBadge(this.ctx.schoolId);
  }

  /** Leave a task out, with the reason. It leaves the percent and the next step; restoring brings it back. */
  async skip(input: unknown): Promise<void> {
    this.authorize("run", "write");
    const d = this.parse(skipTaskInput, input);
    const def = this.def(d.key);
    await this.write("run", async (tx) => {
      const now = new Date();
      const [row] = await tx.insert(setupTasks).values({ schoolId: this.ctx.schoolId, key: def.key, skippedAt: now, skippedBy: this.ctx.userId, skipReason: d.reason })
        .onConflictDoUpdate({ target: [setupTasks.schoolId, setupTasks.key], set: { skippedAt: now, skippedBy: this.ctx.userId, skipReason: d.reason, updatedAt: now } }).returning();
      if (row!.assignedTo) await this.close(tx, row!);
    }, () => ({ action: "skip", entity: "Setup task", entityId: def.key, summary: `Skipped "${def.label}": ${d.reason}` }));
    forgetBadge(this.ctx.schoolId);
  }

  async restore(input: unknown): Promise<void> {
    const { key } = this.parse(taskKeyInput, input);
    const def = this.def(key);
    await this.write("run", async (tx) => {
      await tx.update(setupTasks).set({ skippedAt: null, skippedBy: null, skipReason: null, updatedAt: new Date() }).where(eq(setupTasks.key, def.key));
    }, () => ({ action: "restore", entity: "Setup task", entityId: def.key, summary: `Brought back "${def.label}"` }));
    forgetBadge(this.ctx.schoolId);
  }

  /** Hide or show the getting-started card for the whole school (not for one browser). */
  async setCardHidden(hidden: boolean): Promise<void> {
    await this.write("run", async (tx) => {
      const now = new Date();
      await tx.insert(setupTasks).values({ schoolId: this.ctx.schoolId, key: CARD_KEY, skippedAt: hidden ? now : null, skippedBy: hidden ? this.ctx.userId : null })
        .onConflictDoUpdate({ target: [setupTasks.schoolId, setupTasks.key], set: { skippedAt: hidden ? now : null, skippedBy: hidden ? this.ctx.userId : null, updatedAt: now } });
    }, () => ({ action: hidden ? "hide" : "show", entity: "Setup", summary: hidden ? "Hid the getting-started card" : "Showed the getting-started card" }));
    forgetBadge(this.ctx.schoolId);
  }

  // ---------- mine ----------

  /** Tasks given to me that are still open. Anyone who signs in may see their own; a task that got done meanwhile is closed. */
  async mine(): Promise<MyTask[]> {
    this.authorize("task", "read");
    const { rows, names, me } = await withSchool(this.ctx.schoolId, async (tx) => {
      const rows = [...(await this.rows(tx)).values()].filter((r) => r.assignedTo === this.ctx.userId && !r.skippedAt);
      const ids = [...new Set(rows.map((r) => r.assignedBy).filter((x): x is string => !!x))];
      const names = new Map(ids.length ? (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : []);
      const [u] = await tx.select({ roleName: schoolRoles.name, grants: schoolRoles.grants }).from(users).leftJoin(schoolRoles, eq(schoolRoles.id, users.roleId)).where(eq(users.id, this.ctx.userId)).limit(1);
      return { rows, names, me: { role: this.ctx.role, grants: u?.roleName ? u.grants : null } };
    });
    const defs = this.defs(rows.map((r) => r.key));
    const { done } = await withSchool(this.ctx.schoolId, (tx) => this.evaluate(tx, defs));
    await this.closeDone(rows.filter((r) => done.get(r.key)));
    return defs.filter((d) => !done.get(d.key)).map((d) => {
      const r = rows.find((x) => x.key === d.key)!;
      return { key: d.key, label: d.label, why: d.why, minutes: d.minutes, href: d.href, assignedBy: r.assignedBy ? names.get(r.assignedBy) ?? null : null, assignedAt: r.assignedAt, canDo: canDoTask(d, me) };
    });
  }
}
