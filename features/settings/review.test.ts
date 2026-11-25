import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, eq, sql, uuidv7, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import { AuditService } from "./audit-service";
import type { Catalogue } from "./catalogue";
import { clearMemo } from "./data-base";
import { runExports } from "./export-run";
import { ExportService } from "./export-service";
import { watchSignIns } from "./jobs-signin";
import { privacyDue } from "./jobs";
import { PrivacyService } from "./privacy-service";
import { HubService, RoleService, UserAdminService } from "./service";
import { readZip } from "./zip";
import { dataExports } from "./schema";

const library = { key: "library", name: "Library", permissions: { read: ["admin", "teacher"], manage: ["admin", "teacher"] } } as const;
const CAT: Catalogue = [library];
let a: TestSchool, b: TestSchool;
const storage = new MemoryStorage();
beforeAll(async () => { ({ a, b } = await createSchoolPair(["settings", "students", "payroll", "library"], "-rev")); useServices({ storage, email: new MemoryEmailSender() }); });
afterAll(closeDb);

const istDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("the last admin, under pressure", () => {
  it("two admins disabling each other at the same moment: exactly one wins", async () => {
    const [second] = await withConsole((tx) => tx.execute<{ id: string }>(sql`insert into users (id, school_id, role, login_id, name, email, status) values (${uuidv7()}, ${a.id}, 'admin', 'second-admin-rev', 'Second Admin', 'second-rev@test', 'active') returning id`));
    const other = { ...a.as.admin, userId: second!.id, name: "Second Admin" };
    // The original admin and this one are the only admins left: demote the school's other admin-like users first.
    await withConsole((tx) => tx.execute(sql`update users set status = 'disabled' where school_id = ${a.id} and role = 'admin' and id not in (${a.users.admin}, ${second!.id})`));
    const results = await Promise.allSettled([new UserAdminService(a.as.admin).disable(second!.id), new UserAdminService(other).disable(a.users.admin)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
    const [active] = await withConsole((tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from users where school_id = ${a.id} and role = 'admin' and status = 'active'`));
    expect(active!.n).toBe(1);
  });
});

describe("roles and logins: audit in words, and no support session", () => {
  const catalogue = CAT;
  it("a role edit and a login change write old → new for the Audit log", async () => {
    const roles = new RoleService(b.as.admin);
    const role = await roles.create({ name: "Front desk", base: "staff", description: "", grants: [] }, catalogue);
    await roles.update(role.key, { name: "Front office", base: "staff", description: "Reception", grants: ["library:read"] }, catalogue);
    const rows = await withSchool(b.id, (tx) => tx.execute<{ action: string; meta: { changes: Record<string, unknown[]> } }>(sql`select action, meta from audit_logs where entity = 'Role' order by created_at`));
    expect(rows.find((r) => r.action === "update_role")!.meta.changes).toMatchObject({ Name: ["Front desk", "Front office"], Description: [null, "Reception"], "Permissions added": [null, "library: read"] });
    expect(rows.find((r) => r.action === "create_role")!.meta.changes).toMatchObject({ Name: [null, "Front desk"] });
    const detail = await new AuditService(b.as.admin).list({ q: "Changed the role" });
    expect((await new AuditService(b.as.admin).detail(detail.rows[0]!.id)).changes.map((c) => c.field)).toEqual(expect.arrayContaining(["Name", "Description"]));
  });

  it("a user's role change, disable and enable write their changes", async () => {
    const svc = new UserAdminService(b.as.admin);
    await svc.disable(b.users.teacher);
    await svc.enable(b.users.teacher);
    const rows = await withSchool(b.id, (tx) => tx.execute<{ action: string; meta: { changes: Record<string, unknown[]> } }>(sql`select action, meta from audit_logs where entity = 'User' and entity_id = ${b.users.teacher} order by created_at`));
    expect(rows.find((r) => r.action === "disable")!.meta.changes).toEqual({ Account: ["Active", "Disabled"] });
    expect(rows.find((r) => r.action === "enable")!.meta.changes.Account![0]).toBe("Disabled");
  });

  it("role writes are refused in a support session", async () => {
    const support = new RoleService({ ...b.as.admin, supportStaffId: uuidv7() });
    await expect(support.create({ name: "Sneaky", base: "staff", description: "", grants: [] }, catalogue)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(support.update(uuidv7(), { name: "Sneaky", base: "staff", description: "", grants: [] }, catalogue)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(support.copy(uuidv7())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(support.remove(uuidv7())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the audit page is cheap and reads every shape of change", () => {
  it("understands { from, to } objects as well as [old, new]", async () => {
    const id = uuidv7();
    await withSchool(a.id, (tx) => tx.execute(sql`insert into audit_logs (id, school_id, actor_user_id, module, action, entity, summary, meta) values (${id}, ${a.id}, ${a.users.admin}, 'x', 'update', 'Thing', 'Hand written', ${JSON.stringify({ changes: { nameShown: { from: "A", to: "B" }, plain: ["c", "d"], junk: "no" } })}::jsonb)`));
    const d = await new AuditService(a.as.admin).detail(id);
    expect(d.changes).toEqual(expect.arrayContaining([{ field: "Name shown", from: "A", to: "B" }, { field: "Plain", from: "c", to: "d" }]));
    expect(d.changes).toHaveLength(2);
  });

  it("lists modules by hopping the index, and actions and people from the last 90 days only", async () => {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    await withSchool(a.id, (tx) => tx.execute(sql`insert into audit_logs (id, school_id, actor_user_id, module, action, summary, created_at) values (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'zzold', 'ancient', 'Old', ${old}::timestamptz), (${uuidv7()}, ${a.id}, ${a.users.admin}, 'aanew', 'fresh', 'New', now())`));
    const svc = new AuditService(a.as.admin);
    const modules = await svc.modules();
    expect(modules).toEqual([...modules].sort());
    expect(modules).toEqual(expect.arrayContaining(["aanew", "zzold"]));
    expect(new Set(modules).size).toBe(modules.length);
    expect(await svc.actions()).toContain("fresh");
    expect(await svc.actions()).not.toContain("ancient");
    expect((await svc.actors()).map((x) => x.id)).not.toContain(a.users.teacher);
    expect(await new AuditService(b.as.admin).modules()).not.toContain("aanew");
  });

  it("the Settings front page counts are kept for a minute", async () => {
    clearMemo();
    const hub = new HubService(b.as.admin);
    const before = await hub.attention();
    await withConsole((tx) => tx.execute(sql`insert into users (id, school_id, role, login_id, name, status) values (${uuidv7()}, ${b.id}, 'accountant', 'invited-rev', 'Invited One', 'invited')`));
    expect(await hub.attention()).toEqual(before);
    clearMemo();
    expect((await hub.attention()).map((x) => x.key)).toContain("invited");
  });
});

describe("settings that are the school's own", () => {
  it("the days to answer cannot be changed in a read-only school, but requests can still be raised", async () => {
    await expect(new PrivacyService({ ...a.as.admin, readOnly: true }).setDays({ days: 30 })).rejects.toThrow(/read-only/);
    await expect(new PrivacyService({ ...a.as.teacher, readOnly: true }).raise({ kind: "access", details: "A copy of my record, please" })).resolves.toBeTruthy();
    expect(await new PrivacyService(a.as.admin).setDays({ days: 60 })).toBe(60);
    await new PrivacyService(a.as.admin).setDays({ days: 90 });
    const rows = await new AuditService(a.as.admin).list({ q: "time to answer" });
    expect(rows.total).toBe(2);
  });
});

describe("jobs do not fail together", () => {
  it("a school whose reminders fail does not stop the next one, and a disabled owner's reminder goes to the admins", async () => {
    const mk = async (s: TestSchool, owner?: string) => {
      const r = await new PrivacyService(s.as.admin).create({ kind: "access", details: "A reminder test request", subjectType: "other", subjectName: "Remind Me", raisedByName: "Remind Me" });
      await withConsole((tx) => tx.execute(sql`update privacy_requests set due_on = ${plus(istDay(), 3)}::date, reminded_on = null, owner_id = ${owner ?? s.users.admin} where id = ${r.id}`));
      return r.id;
    };
    // Only these two requests count in this run: close the others the earlier tests left open.
    await withConsole((tx) => tx.execute(sql`update privacy_requests set state = 'done' where state in ('open','in_progress')`));
    const ownerGone = await mk(a, a.users.teacher);
    await withConsole((tx) => tx.execute(sql`update users set status = 'disabled' where id = ${a.users.teacher}`));
    const other = await mk(b);
    const real = NotificationWriter.insert.bind(NotificationWriter);
    const spy = vi.spyOn(NotificationWriter, "insert").mockImplementation(async (tx, schoolId, rows) => {
      if (schoolId === a.id && rows.some((r) => r.subject.id === ownerGone) && rows.every((r) => r.userId === a.users.teacher)) throw new Error("boom");
      return real(tx, schoolId, rows);
    });
    // The disabled owner is not told: the admins are, so nothing throws for school A and school B is told as well.
    await privacyDue();
    spy.mockRestore();
    const noteFor = (s: TestSchool, id: string) => withSchool(s.id, (tx) => tx.execute<{ user_id: string }>(sql`select user_id from notifications where subject_id = ${id} and topic = 'privacy.request' and title like '%due in%'`));
    const admins = (await withConsole((tx) => tx.execute<{ id: string }>(sql`select id from users where school_id = ${a.id} and role = 'admin' and status = 'active'`))).map((u) => u.id);
    expect((await noteFor(a, ownerGone)).map((n) => n.user_id).sort()).toEqual(admins.sort());
    expect((await noteFor(b, other)).map((n) => n.user_id)).toEqual([b.users.admin]);
  });

  it("when one school throws, the others are still done and the job fails at the end so the queue tries again", async () => {
    await withConsole((tx) => tx.execute(sql`update privacy_requests set state = 'done' where state in ('open','in_progress')`));
    const mk = async (s: TestSchool) => {
      const r = await new PrivacyService(s.as.admin).create({ kind: "access", details: "A second reminder test", subjectType: "other", subjectName: "Remind Two", raisedByName: "Remind Two" });
      await withConsole((tx) => tx.execute(sql`update privacy_requests set due_on = ${plus(istDay(), 2)}::date, reminded_on = null where id = ${r.id}`));
      return r.id;
    };
    const ra = await mk(a), rb = await mk(b);
    const real = NotificationWriter.insert.bind(NotificationWriter);
    const spy = vi.spyOn(NotificationWriter, "insert").mockImplementation(async (tx, schoolId, rows) => { if (schoolId === a.id) throw new Error("boom"); return real(tx, schoolId, rows); });
    await expect(privacyDue()).rejects.toThrow(/failed for 1 of 2 schools/);
    spy.mockRestore();
    const marked = await withConsole((tx) => tx.execute<{ id: string; reminded_on: string | null }>(sql`select id, reminded_on::text from privacy_requests where id in (${ra}, ${rb})`));
    expect(marked.find((r) => r.id === rb)!.reminded_on).toBe(istDay());
    expect(marked.find((r) => r.id === ra)!.reminded_on).toBeNull();
  });

  it("the sign-in watch does the same", async () => {
    const bad = async (s: TestSchool) => {
      const id = `teacher-${s.slug}`;
      for (let i = 0; i < 10; i++) await new (await import("@smw/auth")).SchoolAuth(s.id).login(id, "wrong-pass-9", { ip: `8.${i}.${s.slug.length}.1` }).catch(() => undefined);
    };
    const { loginLimiter } = await import("@smw/auth");
    for (const s of [a, b]) loginLimiter.reset(`acct:${s.id}:teacher-${s.slug}`);
    await bad(a); await bad(b);
    const real = NotificationWriter.insert.bind(NotificationWriter);
    const spy = vi.spyOn(NotificationWriter, "insert").mockImplementation(async (tx, schoolId, rows) => { if (schoolId === a.id) throw new Error("boom"); return real(tx, schoolId, rows); });
    await expect(watchSignIns()).rejects.toThrow(/failed for/);
    spy.mockRestore();
    const told = await withSchool(b.id, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from notifications where topic = 'account.security'`));
    expect(told[0]!.n).toBeGreaterThan(0);
  });
});

describe("what an access export holds", () => {
  const read = async (id: string, schoolId = a.id) => {
    await runExports({ schoolId });
    const [row] = await withSchool(schoolId, (tx) => tx.select().from(dataExports).where(eq(dataExports.id, id)));
    const files = readZip(await storage.get(row!.fileKey!));
    return { files, text: [...files.values()].map((f) => f.toString("utf8")).join("\n") };
  };

  it("a student's file has their guardians (not other children's) and their login row without secrets", async () => {
    const [kid, other, g1, g2, login] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), a.users.student];
    await withSchool(a.id, async (tx) => {
      await tx.execute(sql`insert into students (id, school_id, admission_no, name, user_id) values (${kid}, ${a.id}, 'AX-1', 'Access Kid', ${login}), (${other}, ${a.id}, 'AX-2', 'Other Kid', null)`);
      await tx.execute(sql`insert into guardians (id, school_id, name, relation, phone) values (${g1}, ${a.id}, 'Own Guardian', 'mother', '9811100111'), (${g2}, ${a.id}, 'Stranger Guardian', 'father', '9811100222')`);
      await tx.execute(sql`insert into student_guardians (id, school_id, student_id, guardian_id, is_primary) values (${uuidv7()}, ${a.id}, ${kid}, ${g1}, true), (${uuidv7()}, ${a.id}, ${other}, ${g2}, true)`);
    });
    const r = await new ExportService(a.as.admin).exportStudent({ studentId: kid });
    const { files, text } = await read(r.id);
    expect(files.get("data/guardians.csv")!.toString()).toContain("Own Guardian");
    expect(text).not.toContain("Stranger Guardian");
    const users = files.get("data/users.csv")!.toString();
    expect(users.split("\n")[0]).not.toContain("password_hash");
    expect(users).toContain(login);
    expect(users).not.toContain(a.users.teacher);
  });

  it("a staff member's file has their own pay (not others'), without sealed numbers", async () => {
    await withSchool(a.id, (tx) => tx.execute(sql`insert into pay_profiles (id, school_id, user_id, pan_sealed, pan_last4) values (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'v1.secret.pan', '111A'), (${uuidv7()}, ${a.id}, ${a.users.accountant}, 'v1.other.pan', '222B')`));
    const r = await new ExportService(a.as.admin).exportPerson({ userId: a.users.teacher });
    const { files, text } = await read(r.id);
    expect(files.get("data/pay_profiles.csv")!.toString()).toContain("111A");
    expect(text).not.toContain("222B");
    expect(text).not.toContain("v1.secret.pan");
    await expect(new PrivacyService(b.as.admin).makeAccessExport(uuidv7())).rejects.toBeInstanceOf(NotFoundError);
    expect(ValidationError).toBeTruthy();
  });
});
