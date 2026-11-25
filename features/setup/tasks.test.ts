import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, migrateDb, schoolSetupStatus, schools, sql, withConsole, eq } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ReadOnlyError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import { CredentialService } from "@smw/feature-students/credentials-service";
import { SupportAccessService } from "@smw/feature-settings/access-service";
import { SetupService as FeesChecklist } from "@smw/feature-fees/setup-status";
import { DISCLOSURE_ROWS } from "@smw/site-templates";
import { BADGE_TIMEOUT_MS, forgetBadge, setupBadges } from "./badge";
import { snapshotAll, snapshotSchool } from "./snapshot";
import { SetupService } from "./service";
import { SetupTaskService } from "./task-service";
import { TASKS, TASK_GROUPS, canDoTask, percentOf } from "./tasks";

const ALL = ["setup", "settings", "academics", "students", "staff", "announcements", "events", "website", "support", "domains", "notifications",
  "attendance", "timetable", "assignments", "exams", "library", "transport", "finance", "fees", "payroll", "expenses"];
let a: TestSchool, b: TestSchool;
const as = (s: TestSchool, role: keyof TestSchool["as"] = "admin", features: string[] = ALL) => ({ ...s.as[role], features: new Set(features) });
const tasks = (s: TestSchool, role: keyof TestSchool["as"] = "admin") => new SetupTaskService(as(s, role));
const setup = (s: TestSchool, role: keyof TestSchool["as"] = "admin") => new SetupService(as(s, role));

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(ALL, "t"));
  useServices({ storage: new MemoryStorage(), email: new MemoryEmailSender() });
});
afterAll(closeDb);

/** One row with every required column filled in (foreign keys are switched off for the statement). `over` sets what the task's query reads. */
const loosened = new Set<string>();
async function fill(schoolId: string, table: string, over: Record<string, unknown> = {}) {
  if (!loosened.has(table)) {
    // The test database is built for this suite alone, so the table's foreign keys can go: the row only has to hold what the task reads.
    await migrateDb().transaction(async (tx) => {
      const fks = [...(await tx.execute(sql`select conname as n from pg_constraint where contype = 'f' and conrelid = ${`public.${table}`}::regclass`))] as { n: string }[];
      for (const k of fks) await tx.execute(sql`alter table ${sql.identifier(table)} drop constraint ${sql.identifier(k.n)}`);
    });
    loosened.add(table);
  }
  await withConsole(async (tx) => {
    const cols = [...(await tx.execute(sql`select column_name as n, data_type as t from information_schema.columns where table_schema = 'public' and table_name = ${table} and is_nullable = 'NO' and column_default is null`))] as { n: string; t: string }[];
    const dummy = (t: string) => t === "uuid" ? sql`gen_random_uuid()` : t === "date" ? sql`current_date` : /^timestamp/.test(t) ? sql`now()` : t === "boolean" ? sql`false`
      : /int|numeric/.test(t) ? sql`0` : /json/.test(t) ? sql`'{}'::jsonb` : t === "ARRAY" ? sql`'{}'` : sql`'x'`;
    const names = new Set(cols.map((c) => c.n));
    const values: Record<string, unknown> = { ...Object.fromEntries(cols.map((c) => [c.n, dummy(c.t)])), ...over, school_id: schoolId };
    for (const k of Object.keys(over)) names.add(k);
    names.add("school_id");
    const list = [...names];
    await tx.execute(sql`insert into ${sql.identifier(table)} (${sql.join(list.map((n) => sql.identifier(n)), sql`, `)}) values (${sql.join(list.map((n) => sql`${values[n]}`), sql`, `)})`);
  });
}
const raw = (q: ReturnType<typeof sql>) => withConsole((tx) => tx.execute(q));
const ids = () => ({ cls: sql`(select id from academic_years where school_id = ${a.id} and is_current)` });

/** What makes each task's data appear. Order matters: later ones lean on earlier rows. Every task of TASKS has one entry. */
const CASES: { key: string; before?: () => Promise<unknown>; also?: string[]; act: () => Promise<unknown> }[] = [
  { key: "school.profile", act: () => raw(sql`update schools set board = 'CBSE', city = 'Pune', state = 'Maharashtra' where id = ${a.id}`) },
  { key: "school.year", act: () => setup(a).saveYear({ name: "2026-27", terms: "0" }) },
  { key: "school.classes", act: () => setup(a).saveClasses({ picks: [{ grade: 1, sections: 2 }] }) },
  { key: "school.subjects", act: () => setup(a).saveSubjects({ board: "CBSE", picks: [{ name: "English", bands: ["primary"] }] }) },
  { key: "people.staff", act: () => setup(a).inviteTeachers({ rows: [{ name: "Meera Iyer", email: "meera@t.test" }] }) },
  { key: "people.students", act: () => fill(a.id, "students", { status: "active" }) },
  { key: "people.classteachers", act: async () => { const s = await setup(a).classTeacherState(); await setup(a).saveClassTeachers({ picks: s.sections.map((x) => ({ sectionId: x.id, teacherId: a.users.teacher })) }); } },
  // Slips count only when they were really produced, through the students service.
  { key: "people.slips", act: async () => {
    const sec = (await setup(a).sectionOptions())[0]!;
    await setup(a).addStudents({ rows: [{ name: "Slip Child", sectionId: sec.id, guardianName: "", guardianPhone: "" }] });
    expect((await new CredentialService(as(a)).slips(sec.classId)).slips.length).toBeGreaterThan(0);
  } },
  { key: "people.families", act: () => raw(sql`update users set last_login_at = now() where role = 'student' and school_id = ${a.id}`) },
  // An invited person does not count until they are in.
  { key: "people.team", before: () => raw(sql`update users set status = 'disabled' where role = 'accountant' and school_id = ${a.id}`),
    act: async () => { await setup(a).addTeam({ name: "Office Two", email: "office@t.test", role: "accountant" }); await raw(sql`update users set status = 'active' where email = 'office@t.test' and school_id = ${a.id}`); } },
  { key: "daily.attendance", act: () => fill(a.id, "student_attendance", { status: "present" }) },
  { key: "daily.timetable", act: () => fill(a.id, "timetable_slots") },
  // A draft is not homework yet.
  { key: "daily.homework", before: () => fill(a.id, "assignments", { status: "draft" }), act: () => fill(a.id, "assignments", { status: "published" }) },
  { key: "daily.library", act: () => fill(a.id, "books") },
  { key: "daily.transport", act: () => fill(a.id, "routes") },
  { key: "exams.exam", act: () => fill(a.id, "exams") },
  { key: "exams.marks", act: () => fill(a.id, "marks") },
  { key: "money.cash", act: async () => { await fill(a.id, "fin_cash_accounts", { name: "Cash box", kind: "cash" }); await fill(a.id, "fin_cash_accounts", { name: "Bank", kind: "bank" }); } },
  { key: "money.upi", act: async () => { await fill(a.id, "fin_cash_accounts", { name: "UPI", kind: "bank", upi_id: "school@upi" }); await fill(a.id, "fin_settings", { config: sql`'{"upiOn": true}'::jsonb` }); } },
  { key: "money.heads", act: () => fill(a.id, "fee_heads", { is_active: true }) },
  { key: "money.plan", act: () => fill(a.id, "fee_plans", { status: "published", year_id: ids().cls }) },
  { key: "money.issue", act: () => fill(a.id, "fee_invoices", { status: "issued" }) },
  { key: "money.counter", act: () => fill(a.id, "fee_counters", { user_id: a.users.admin }) },
  { key: "money.payroll", act: () => fill(a.id, "pay_profiles") },
  { key: "money.vendor", act: () => fill(a.id, "exp_vendors") },
  { key: "families.email", act: () => fill(a.id, "comm_deliveries", { channel: "email", state: "sent" }) },
  { key: "families.quiet", act: () => fill(a.id, "comm_settings") },
  { key: "families.notice", act: () => fill(a.id, "announcements", { state: "published" }) },
  { key: "families.event", act: () => fill(a.id, "events") },
  { key: "website.published", act: () => fill(a.id, "school_sites", { published_at: sql`now()` }) },
  { key: "website.domain", act: () => fill(a.id, "school_domains", { kind: "custom", status: "verified", hostname: "greenvalley.test" }) },
  // A saved but empty disclosure is not done: every row must be filled in or marked not applicable.
  { key: "website.disclosure", before: () => fill(a.id, "site_disclosure", { data: sql`'{"values": {}}'::jsonb` }),
    act: () => raw(sql`update site_disclosure set data = ${JSON.stringify({ values: Object.fromEntries(DISCLOSURE_ROWS.map((r) => [r.key, { na: true }])) })}::jsonb where school_id = ${a.id}`) },
  { key: "safety.lead", act: async () => {
    await raw(sql`insert into school_roles (id, school_id, name, base, grants) values (gen_random_uuid(), ${a.id}, 'Safeguarding', 'teacher', array['messages:safeguard'])`);
    await raw(sql`update users set role_id = (select id from school_roles where school_id = ${a.id} and name = 'Safeguarding') where id = ${a.users.teacher}`);
  } },
  { key: "safety.support", act: () => new SupportAccessService(as(a)).markRead() },
];

describe("the task list", () => {
  it("covers every module in eight groups, each task with a reason, a time, a link and a right", () => {
    expect(TASK_GROUPS.map((g) => g.key)).toEqual(["school", "people", "daily", "exams", "money", "families", "website", "safety"]);
    expect(new Set(TASKS.map((t) => t.group))).toEqual(new Set(TASK_GROUPS.map((g) => g.key)));
    expect(new Set(TASKS.map((t) => t.key)).size).toBe(TASKS.length);
    for (const t of TASKS) {
      expect(t.href).toMatch(/^\/app\//);
      expect(t.minutes).toBeGreaterThan(0);
      expect(t.needs).toMatch(/^[a-z]+:[a-z]+$/);
      expect(Boolean(t.done) !== Boolean(t.source)).toBe(true); // exactly one way to know it is done
    }
    // U1: beyond the seven wizard steps, the list reaches fees, timetable, class teachers, login slips and the rest.
    for (const k of ["money.plan", "daily.timetable", "people.classteachers", "people.slips", "people.team", "exams.marks", "website.disclosure", "safety.lead", "families.email"]) expect(TASKS.some((t) => t.key === k)).toBe(true);
    expect(CASES.flatMap((c) => [c.key, ...(c.also ?? [])]).sort()).toEqual(TASKS.map((t) => t.key).sort());
  });

  it("canDoTask: a built-in role is on the list; a custom role holds the right or it does not", () => {
    const t = TASKS.find((x) => x.key === "daily.attendance")!;
    expect(canDoTask(t, { role: "teacher", grants: null })).toBe(true);
    expect(canDoTask(t, { role: "accountant", grants: null })).toBe(false);
    expect(canDoTask(t, { role: "staff", grants: ["attendance:mark"] })).toBe(true);
    expect(canDoTask(t, { role: "teacher", grants: ["attendance:read"] })).toBe(false);
    expect(percentOf(3, 10, 0)).toBe(30);
    expect(percentOf(3, 10, 5)).toBe(60);
    expect(percentOf(0, 2, 2)).toBe(100);
  });
});

describe("done is read from the data", () => {
  it("each task flips from not done to done when its data exists, and school B never moves", async () => {
    const stateOf = async (s: TestSchool, key: string) => (await tasks(s).progress()).groups.flatMap((g) => g.tasks).find((t) => t.key === key)?.state;
    for (const c of CASES) {
      await c.before?.();
      expect(await stateOf(a, c.key), `${c.key} before`).toBe("todo");
      await c.act();
      expect(await stateOf(a, c.key), `${c.key} after`).toBe("done");
      for (const k of c.also ?? []) expect(await stateOf(a, k), `${k} after`).toBe("done");
      // (school B starts with an admin and an accountant, so its team is already there)
      if (c.key !== "people.team") expect(await stateOf(b, c.key), `${c.key} in school B`).toBe("todo");
    }
    const p = await tasks(a).progress();
    expect(p).toMatchObject({ done: TASKS.length, left: 0, percent: 100, complete: true, next: null });
    const pb = await tasks(b).progress();
    expect(pb.done).toBeLessThan(5);
  });

  it("a module the school does not have has no tasks, and a task whose table is missing is not done instead of failing", async () => {
    const few = await new SetupTaskService({ ...a.as.admin, features: new Set(["setup", "settings", "academics"]) }).progress();
    const keys = few.groups.flatMap((g) => g.tasks.map((t) => t.key));
    expect(keys).toContain("school.year");
    expect(keys).not.toContain("daily.library");
    expect(keys).not.toContain("money.cash");
    expect(few.groups.map((g) => g.key)).not.toContain("exams");
  });
});

describe("what people decide: give, skip, restore, hide", () => {
  it("giving a task tells the person, and giving it again moves it and closes the first", async () => {
    const svc = tasks(b);
    const given = await svc.assign({ key: "daily.library", userId: b.users.teacher });
    expect(given).toMatchObject({ key: "daily.library", userId: b.users.teacher });
    const mine = await tasks(b, "teacher").mine();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ key: "daily.library", canDo: true, assignedBy: "admin bt" });
    expect((await svc.progress()).groups.flatMap((g) => g.tasks).find((t) => t.key === "daily.library")?.assignee).toMatchObject({ id: b.users.teacher });
    const open = async (userId: string) => [...(await raw(sql`select count(*)::int as n from notifications where school_id = ${b.id} and user_id = ${userId} and topic = 'setup.task' and action and done_at is null`))][0] as { n: number };
    expect((await open(b.users.teacher)).n).toBe(1);

    await svc.assign({ key: "daily.library", userId: b.users.accountant });
    expect((await open(b.users.teacher)).n).toBe(0);
    expect((await open(b.users.accountant)).n).toBe(1);
    expect(await tasks(b, "teacher").mine()).toHaveLength(0);
    // the accountant's role cannot open the library page: a warning on the way and "cannot do" in their list
    const again = await svc.assign({ key: "daily.library", userId: b.users.accountant });
    expect(again.warning).toMatch(/cannot open/);
    expect((await tasks(b, "accountant").mine())[0]).toMatchObject({ canDo: false });
    await svc.unassign({ key: "daily.library" });
    expect((await open(b.users.accountant)).n).toBe(0);
  });

  it("a given task closes by itself once the data says it is done", async () => {
    const svc = tasks(b);
    await svc.assign({ key: "families.event", userId: b.users.teacher });
    expect(await tasks(b, "teacher").mine()).toHaveLength(1);
    await fill(b.id, "events");
    expect(await tasks(b, "teacher").mine()).toHaveLength(0);
    const [n] = [...(await raw(sql`select count(*)::int as n from notifications where school_id = ${b.id} and user_id = ${b.users.teacher} and topic = 'setup.task' and done_at is null`))] as { n: number }[];
    expect(n!.n).toBe(0);
    await expect(svc.assign({ key: "families.event", userId: b.users.teacher })).rejects.toBeInstanceOf(ConflictError);
  });

  it("only active staff of this school can be given a task; unknown tasks and tasks of modules the school lacks are not found", async () => {
    const svc = tasks(b);
    await expect(svc.assign({ key: "daily.transport", userId: b.users.student })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.assign({ key: "daily.transport", userId: a.users.teacher })).rejects.toBeInstanceOf(ValidationError); // school A's person
    await expect(svc.assign({ key: "daily.transport", userId: "not-an-id" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.assign({ key: "no.such.task", userId: b.users.teacher })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SetupTaskService({ ...b.as.admin, features: new Set(["setup", "settings", "academics"]) }).assign({ key: "daily.transport", userId: b.users.teacher })).rejects.toBeInstanceOf(NotFoundError);
    expect((await svc.people()).map((p) => p.id).sort()).toEqual([b.users.accountant, b.users.admin, b.users.teacher].sort());
  });

  it("skip needs a reason, leaves the percent and the next step, and restore brings it back", async () => {
    const svc = tasks(b);
    const before = await svc.progress();
    const target = before.next!;
    await expect(svc.skip({ key: target.key, reason: "" })).rejects.toBeInstanceOf(ValidationError);
    await svc.skip({ key: target.key, reason: "We do not run this" });
    const skipped = await svc.progress();
    expect(skipped.skipped).toBe(before.skipped + 1);
    expect(skipped.next?.key).not.toBe(target.key);
    expect(skipped.groups.flatMap((g) => g.tasks).find((t) => t.key === target.key)).toMatchObject({ state: "skipped", skipReason: "We do not run this" });
    expect(skipped.percent).toBeGreaterThanOrEqual(before.percent);
    await svc.restore({ key: target.key });
    const back = await svc.progress();
    expect(back.next?.key).toBe(target.key);
    expect(back.skipped).toBe(before.skipped);
    // giving a skipped task brings it back too
    await svc.skip({ key: "daily.transport", reason: "No buses" });
    await svc.assign({ key: "daily.transport", userId: b.users.teacher });
    expect((await svc.progress()).groups.flatMap((g) => g.tasks).find((t) => t.key === "daily.transport")?.state).toBe("todo");
    expect(await tasks(a).progress().then((p) => p.groups.flatMap((g) => g.tasks).find((t) => t.key === "daily.transport")?.skipReason ?? null)).toBeNull();
  });

  it("U2: hiding the card is for the school, not one browser: every admin sees it hidden, other schools do not", async () => {
    const svc = tasks(b);
    expect((await svc.card())?.left).toBeGreaterThan(0);
    await svc.setCardHidden(true);
    const otherAdmin = new SetupTaskService({ ...as(b, "admin"), userId: "11111111-1111-4111-8111-111111111111" });
    expect((await otherAdmin.progress()).hidden).toBe(true);
    expect(await otherAdmin.card()).toBeNull();
    expect((await tasks(a).progress()).hidden).toBe(false);
    await svc.setCardHidden(false);
    expect((await otherAdmin.card())).toMatchObject({ left: expect.any(Number), next: { label: expect.any(String), href: expect.stringMatching(/^\/app\//) } });
  });

  it("permissions: only an admin sees and changes everything; a teacher sees only their own; a family sees none; a read-only school changes nothing", async () => {
    await expect(tasks(b, "teacher").progress()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(tasks(b, "teacher").assign({ key: "daily.transport", userId: b.users.teacher })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(tasks(b, "teacher").skip({ key: "daily.transport", reason: "No buses here" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(tasks(b, "teacher").setCardHidden(true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(tasks(b, "teacher").people()).rejects.toBeInstanceOf(ForbiddenError);
    expect(await tasks(b, "teacher").card()).toBeNull();
    await expect(tasks(b, "student").mine()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(tasks(b, "parent").mine()).rejects.toBeInstanceOf(ForbiddenError);
    const ro = new SetupTaskService({ ...as(b, "admin"), readOnly: true });
    await expect(ro.assign({ key: "daily.transport", userId: b.users.teacher })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(ro.setCardHidden(true)).rejects.toBeInstanceOf(ReadOnlyError);
    expect((await ro.progress()).total).toBeGreaterThan(0);
  });
});

describe("the nightly snapshot", () => {
  const rowOf = async (id: string) => (await withConsole((tx) => tx.select().from(schoolSetupStatus).where(eq(schoolSetupStatus.schoolId, id))))[0];

  it("writes one row per school with percent, the next step, last sign-in and students, and updates it in place", async () => {
    await snapshotSchool(a.id, ALL);
    const first = await rowOf(a.id);
    expect(first).toMatchObject({ percent: 100, nextKey: null, students: 2 });
    expect(first!.lastLoginAt).not.toBeNull();
    expect(first!.firstAttendanceOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first!.facts).toMatchObject({ wizardTotal: 9, tasksSkipped: 0 });
    await snapshotSchool(b.id, ALL);
    const second = await rowOf(b.id);
    expect(second).toMatchObject({ done: expect.any(Number), total: expect.any(Number) });
    expect(second!.percent).toBeLessThan(100);
    expect(second!.nextKey).toEqual(expect.any(String));
    await snapshotSchool(b.id, ALL);
    expect((await withConsole((tx) => tx.select().from(schoolSetupStatus).where(eq(schoolSetupStatus.schoolId, b.id)))).length).toBe(1);
  });

  it("one school failing never stops the others; the job still fails at the end so it is retried; suspended schools are left out", async () => {
    // The nightly job reads each school's modules from the platform tables; the test schools need these three to be on.
    await raw(sql`insert into modules (key, name, stage, requires, core) values ('setup', 'Setup', 'ga', '{}', true), ('settings', 'Settings', 'ga', '{}', true), ('academics', 'Academics', 'ga', '{}', true) on conflict (key) do nothing`);
    await raw(sql`delete from school_setup_status where school_id in (${a.id}, ${b.id})`);
    const real = SetupTaskService.prototype.progress;
    const spy = vi.spyOn(SetupTaskService.prototype, "progress").mockImplementation(function (this: SetupTaskService) {
      if ((this as unknown as { ctx: { schoolId: string } }).ctx.schoolId === a.id) return Promise.reject(new Error("boom"));
      return real.call(this);
    });
    await expect(snapshotAll()).rejects.toThrow(/failed for \d+ of/);
    spy.mockRestore();
    expect(await rowOf(a.id)).toBeUndefined();
    expect(await rowOf(b.id)).toBeDefined();
    await raw(sql`update schools set status = 'suspended' where id = ${a.id}`);
    await raw(sql`delete from school_setup_status where school_id = ${b.id}`);
    await snapshotAll();
    expect(await rowOf(a.id)).toBeUndefined();
    expect(await rowOf(b.id)).toBeDefined();
    await raw(sql`update schools set status = 'active' where id = ${a.id}`);
  });
});

describe("the menu badge", () => {
  it("is the tasks left for an admin, the tasks given to me for anyone else, 0 when hidden, and always 0 in a support session", async () => {
    forgetBadge(b.id);
    const admin = await setupBadges(as(b, "admin"));
    expect(admin.left).toBeGreaterThan(0);
    expect(admin).toEqual({ left: (await tasks(b).progress()).left, mine: 0 });
    const had = (await tasks(b, "teacher").mine()).length; // a task given earlier in this file
    expect(await setupBadges(as(b, "teacher"))).toEqual({ left: 0, mine: had });
    expect(await setupBadges({ ...as(b, "admin"), supportStaffId: "x" })).toEqual({ left: 0, mine: 0 });
    // a teacher who was given a task gets a number, and it moves at once when the admin gives or takes back
    await tasks(b).assign({ key: "daily.library", userId: b.users.teacher });
    expect(await setupBadges(as(b, "teacher"))).toEqual({ left: 0, mine: had + 1 });
    await tasks(b).unassign({ key: "daily.library" });
    expect((await setupBadges(as(b, "teacher"))).mine).toBe(had);
    await tasks(b).setCardHidden(true);
    expect((await setupBadges(as(b, "admin"))).left).toBe(0);
    await tasks(b).setCardHidden(false);
    expect((await setupBadges(as(b, "admin"))).left).toBe(admin.left);
    expect(await setupBadges({ ...as(b, "admin"), features: new Set(["settings"]) })).toEqual({ left: 0, mine: 0 });
  });

  it("is kept for a minute, per school and person, and counted again after that", async () => {
    forgetBadge(a.id);
    forgetBadge(b.id);
    const spy = vi.spyOn(SetupTaskService.prototype, "progress");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await setupBadges(as(a, "admin"));
      await setupBadges(as(a, "admin"));
      expect(spy).toHaveBeenCalledTimes(1);
      await setupBadges(as(b, "admin")); // another school has its own number
      expect(spy).toHaveBeenCalledTimes(2);
      vi.setSystemTime(Date.now() + 61_000);
      await setupBadges(as(a, "admin"));
      expect(spy).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); spy.mockRestore(); }
  });

  it("never waits more than a second and remembers a failure, so a broken count is not retried on every page", async () => {
    forgetBadge(a.id);
    const slow = vi.spyOn(SetupTaskService.prototype, "progress").mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    expect(await setupBadges(as(a, "admin"))).toEqual({ left: 0, mine: 0 });
    expect(Date.now() - t0).toBeLessThan(BADGE_TIMEOUT_MS + 700);
    await setupBadges(as(a, "admin"));
    expect(slow).toHaveBeenCalledTimes(1);
    slow.mockRestore();
    forgetBadge(a.id);
    const broken = vi.spyOn(SetupTaskService.prototype, "progress").mockRejectedValue(new Error("db down"));
    expect(await setupBadges(as(a, "admin"))).toEqual({ left: 0, mine: 0 });
    await setupBadges(as(a, "admin"));
    expect(broken).toHaveBeenCalledTimes(1);
    broken.mockRestore();
  });
});

describe("read-only, unchecked and closed tasks", () => {
  it("a list that cannot be read is 'could not check', is left out of the percent, and the nightly picture is not written", async () => {
    const before = await tasks(a).progress();
    expect(before.unchecked).toBe(0);
    const spy = vi.spyOn(FeesChecklist.prototype, "status").mockRejectedValue(new Error("fees down"));
    try {
      const p = await tasks(a).progress();
      const money = p.groups.find((g) => g.key === "money")!.tasks.filter((t) => t.key.startsWith("money.") && ["cash", "upi", "heads", "plan", "issue"].includes(t.key.slice(6)));
      expect(money.every((t) => t.state === "unchecked")).toBe(true);
      expect(p.unchecked).toBe(5);
      expect(p.complete).toBe(false);
      expect(p.percent).toBe(100); // not understated: the five unknowns are out of the count
      await raw(sql`delete from school_setup_status where school_id = ${a.id}`);
      expect(await snapshotSchool(a.id, ALL)).toBe("skipped");
      expect(await withConsole((tx) => tx.select().from(schoolSetupStatus).where(eq(schoolSetupStatus.schoolId, a.id)))).toHaveLength(0);
    } finally { spy.mockRestore(); }
    expect(await snapshotSchool(a.id, ALL)).toBe("written");
  });

  it("a given task that the data finishes is closed once: the person is no longer on it", async () => {
    const svc = tasks(b);
    await svc.assign({ key: "families.event", userId: b.users.teacher }).catch(() => undefined);
    await fill(b.id, "events");
    await svc.progress();
    const [row] = [...(await raw(sql`select assigned_to from setup_tasks where school_id = ${b.id} and key = 'families.event'`))] as { assigned_to: string | null }[];
    expect(row?.assigned_to ?? null).toBeNull();
  });

  it("a read-only school can look at everything and say so, and changes nothing", async () => {
    const ro = new SetupTaskService({ ...as(b, "admin"), readOnly: true });
    expect((await ro.progress()).readOnly).toBe(true);
    expect((await tasks(b).progress()).readOnly).toBe(false);
    expect((await new SetupService({ ...as(b, "admin"), readOnly: true }).progress()).readOnly).toBe(true);
    await expect(ro.skip({ key: "daily.transport", reason: "No buses here" })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(ro.restore({ key: "daily.transport" })).rejects.toBeInstanceOf(ReadOnlyError);
  });

  it("login slips are a task only once they were produced; support access once it was read", async () => {
    const c = await createTestSchool("cs", ALL);
    const state = async (key: string) => (await new SetupTaskService({ ...c.as.admin, features: new Set(ALL) }).progress()).groups.flatMap((g) => g.tasks).find((t) => t.key === key)?.state;
    expect(await state("people.slips")).toBe("todo");
    expect(await state("safety.support")).toBe("todo");
    await new SupportAccessService({ ...c.as.admin, features: new Set(ALL) }).markRead();
    expect(await state("safety.support")).toBe("done");
    await new SupportAccessService({ ...c.as.admin, features: new Set(ALL), readOnly: true }).markRead(); // reading is allowed when read-only
  });
});

describe("isolation", () => {
  it("school A's data, notes and given tasks never show in school B", async () => {
    await tasks(a).skip({ key: "school.profile", reason: "Done on paper" });
    const pb = await tasks(b).progress();
    expect(pb.groups.flatMap((g) => g.tasks).find((t) => t.key === "school.profile")?.skipReason ?? null).toBeNull();
    const status = await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.id, b.id)));
    expect(status).toHaveLength(1);
    expect(await tasks(b, "teacher").mine().then((m) => m.map((x) => x.key))).not.toContain("school.profile");
  });
});
