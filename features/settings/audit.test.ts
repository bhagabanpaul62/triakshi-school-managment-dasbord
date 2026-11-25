import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, uuidv7, withSchool } from "@smw/db";
import { ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { AuditService, AUDIT_CSV_LIMIT } from "./audit-service";
import { auditLink } from "./audit-links";
import { SchoolProfileService } from "./service";

let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(["settings", "students"], "-aud")); });
afterAll(closeDb);

const put = (id: string, o: { module?: string; action?: string; entity?: string | null; entityId?: string | null; summary: string; meta?: object; staff?: string | null; user?: string | null; at?: string }, school = a) =>
  withSchool(school.id, (tx) => tx.execute(sql`insert into audit_logs (id, school_id, actor_user_id, actor_staff_id, module, action, entity, entity_id, summary, meta, ip, created_at)
    values (${id}, ${school.id}, ${o.user ?? school.users.admin}, ${o.staff ?? null}, ${o.module ?? "students"}, ${o.action ?? "update"}, ${o.entity ?? null}, ${o.entityId ?? null}, ${o.summary}, ${JSON.stringify(o.meta ?? {})}::jsonb, '203.0.113.9', ${o.at ?? new Date().toISOString()}::timestamptz)`));

describe("AuditService list", () => {
  it("lists school activity with actor names, newest first, and filters it", async () => {
    await new SchoolProfileService(a.as.admin).update({ name: "Audit Test School", timezone: "Asia/Kolkata", academicYearStartMonth: 4 });
    const svc = new AuditService(a.as.admin);
    const page = await svc.list();
    expect(page.total).toBeGreaterThan(0);
    expect(page.rows[0]).toMatchObject({ module: "settings", actor: a.as.admin.name, support: false });
    expect(page.rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(page.rows.at(-1)!.createdAt.getTime());
    expect((await svc.list({ q: "school details" })).rows.every((r) => /school details/i.test(r.summary ?? ""))).toBe(true);
    expect((await svc.list({ filters: { module: "nothing" } })).total).toBe(0);
    expect((await svc.list({ filters: { actor: a.users.admin } })).total).toBeGreaterThan(0);
    expect(await svc.modules()).toContain("settings");
    expect(await svc.actions()).toContain("update");
    expect((await svc.actors()).map((x) => x.id)).toContain(a.users.admin);
  });

  it("filters by date range (IST days), action, text on the thing, record and support only", async () => {
    const svc = new AuditService(a.as.admin);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    expect((await svc.list({ filters: { from: today, to: today } })).total).toBeGreaterThan(0);
    expect((await svc.list({ filters: { from: "2999-01-01" } })).total).toBe(0);
    expect((await svc.list({ filters: { to: "2000-01-01" } })).total).toBe(0);

    const kid = uuidv7(), staff = uuidv7();
    await put(uuidv7(), { action: "create", entity: "Student", entityId: kid, summary: "Added student Z" });
    await put(uuidv7(), { action: "update", entity: "Student", entityId: kid, summary: "Updated student Z", staff });
    expect((await svc.list({ filters: { action: "create", record: kid } })).total).toBe(1);
    expect((await svc.list({ filters: { record: kid } })).total).toBe(2);
    const support = await svc.list({ filters: { support: "1" } });
    expect(support.rows.map((r) => r.summary)).toContain("Updated student Z");
    expect(support.rows.every((r) => r.support && r.actor.endsWith("(via support)"))).toBe(true);
    expect((await svc.list({ q: "student" })).rows.every((r) => /student/i.test(`${r.summary} ${r.entity}`))).toBe(true);
    expect((await svc.list({ q: "100%" })).total).toBe(0);
  });

  it("is admin only", async () => {
    await expect(new AuditService(a.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new AuditService(a.as.accountant).modules()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new AuditService(a.as.teacher).detail(uuidv7())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("isolation: school B never sees school A's entries, in the list or opened", async () => {
    const aRows = (await new AuditService(a.as.admin).list({ pageSize: 100 })).rows;
    const aIds = new Set(aRows.map((r) => r.id));
    expect((await new AuditService(b.as.admin).list({ pageSize: 100 })).rows.some((r) => aIds.has(r.id))).toBe(false);
    expect((await new AuditService(b.as.admin).actors()).some((x) => x.id === a.users.admin)).toBe(false);
    await expect(new AuditService(b.as.admin).detail(aRows[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AuditService detail (S1)", () => {
  it("shows what changed field by field, who, from where, and related entries of the same thing", async () => {
    const kid = uuidv7(), id = uuidv7();
    await withSchool(a.id, (tx) => tx.execute(sql`insert into students (id, school_id, admission_no, name) values (${kid}, ${a.id}, 'AU-1', 'Audit Kid')`));
    await put(uuidv7(), { action: "create", entity: "Student", entityId: kid, summary: "Added student Audit Kid", at: "2026-01-01T05:00:00Z" });
    await put(id, { entity: "Student", entityId: kid, summary: "Updated student Audit Kid", meta: { changes: { phone: ["9811111111", "9822222222"], medicalNotes: ["(hidden)", "(hidden)"], address: [null, "12 Lake Road"] } } });
    const d = await new AuditService(a.as.admin).detail(id);
    expect(d).toMatchObject({ actor: a.as.admin.name, support: false, ip: "203.0.113.9", entity: "Student" });
    expect([...d.changes].sort((x, y) => x.field.localeCompare(y.field))).toEqual([
      { field: "Address", from: "(empty)", to: "12 Lake Road" },
      { field: "Medical notes", from: "(hidden)", to: "(hidden)" },
      { field: "Phone", from: "9811111111", to: "9822222222" },
    ]);
    expect(d.link).toMatchObject({ href: `/app/students/${kid}`, label: "Student" });
    expect(d.related.map((r) => r.summary)).toEqual(["Added student Audit Kid"]);
  });

  it("offers no link once the record is gone, and none for an entity without a page", async () => {
    const gone = uuidv7(), a1 = uuidv7(), a2 = uuidv7();
    await put(a1, { entity: "Student", entityId: gone, summary: "Deleted student X", action: "delete" });
    await put(a2, { entity: "Weird thing", entityId: gone, summary: "Did a thing" });
    const svc = new AuditService(a.as.admin);
    expect((await svc.detail(a1)).link).toBeNull();
    expect((await svc.detail(a2)).link).toBeNull();
    expect(auditLink("Website", null)).toEqual({ href: "/app/website", label: "Website" });
    expect(auditLink("Student", "not-a-uuid")).toBeNull();
  });

  it("an entry with no recorded fields says so (empty changes), and a hidden-about-me entry cannot be opened", async () => {
    const plain = uuidv7(), mine = uuidv7();
    await put(plain, { entity: "Student", entityId: uuidv7(), summary: "Something" });
    await put(mine, { module: "messages", action: "report", summary: "ABOUT-ME", meta: { aboutUserIds: [a.users.admin] } });
    const svc = new AuditService(a.as.admin);
    expect((await svc.detail(plain)).changes).toEqual([]);
    await expect(svc.detail(mine)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.detail("nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("things written about the person who asks", () => {
  it("the list hides entries of messages and requests that name the viewer, and shows the rest", async () => {
    await put(uuidv7(), { module: "messages", action: "report", summary: "ABOUT-ME report opened", meta: { aboutUserIds: [a.users.admin] } });
    await put(uuidv7(), { module: "requests", action: "complaint", summary: "ABOUT-ME complaint", meta: { aboutUserIds: [a.users.teacher, a.users.admin] } });
    await put(uuidv7(), { module: "messages", action: "report", summary: "ABOUT-OTHER report opened", meta: { aboutUserIds: [a.users.teacher] } });
    const rows = await new AuditService(a.as.admin).list({ q: "ABOUT-", pageSize: 50 });
    expect(rows.rows.map((r) => r.summary)).toEqual(["ABOUT-OTHER report opened"]);
    expect(rows.total).toBe(1);
  });

  it("the CSV hides them too", async () => {
    const seen: string[] = [];
    for await (const chunk of new AuditService(a.as.admin).csvChunks({ q: "ABOUT-" })) seen.push(...chunk.map((r) => r.summary ?? ""));
    expect(seen).toEqual(["ABOUT-OTHER report opened"]);
  });
});

describe("AuditService CSV", () => {
  it("streams in chunks of 1,000 by (time, id), with no row twice even when times tie, and logs the download once", async () => {
    await withSchool(a.id, (tx) => tx.execute(sql`insert into audit_logs (id, school_id, module, action, summary, created_at) select gen_random_uuid(), ${a.id}, 'csvtest', 'tie', 'tied ' || g, '2026-02-02T10:00:00Z'::timestamptz from generate_series(1, 2300) g`));
    const svc = new AuditService(a.as.admin);
    const before = (await svc.list({ filters: { action: "export" } })).rows.filter((r) => /CSV/.test(r.summary ?? "")).length;
    const sizes: number[] = [], ids: string[] = [];
    for await (const chunk of svc.csvChunks({ filters: { module: "csvtest" } })) { sizes.push(chunk.length); ids.push(...chunk.map((r) => r.id)); }
    expect(sizes).toEqual([1000, 1000, 300]);
    expect(new Set(ids).size).toBe(2300);
    const logs = await svc.list({ filters: { action: "export" } });
    expect(logs.rows.filter((r) => /CSV/.test(r.summary ?? ""))).toHaveLength(before + 1);
    expect(AUDIT_CSV_LIMIT).toBe(50_000);
  });

  it("is admin only and school-scoped", async () => {
    await expect(new AuditService(a.as.teacher).csvChunks().next()).rejects.toBeInstanceOf(ForbiddenError);
    const seen: string[] = [];
    for await (const chunk of new AuditService(b.as.admin).csvChunks({ filters: { module: "csvtest" } })) seen.push(...chunk.map((r) => r.id));
    expect(seen).toEqual([]);
  });
});
