// Migration 0013 on data shaped like the old schema, rule by rule (docs/WEBSITE-ADMIN-PRD.md section 14).
import { randomUUID as id } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@smw/config";

const REPO = resolve(import.meta.dirname, "../../..");
const MIG = join(REPO, "packages/db/migrations");
const DB = "smw_t_migration_0013";
const journal = (JSON.parse(readFileSync(join(MIG, "meta/_journal.json"), "utf8")).entries as { tag: string }[]).map((e) => e.tag);
const steps = (tag: string) => readFileSync(join(MIG, `${tag}.sql`), "utf8").split("--> statement-breakpoint");
const A = id(), B = id(), T1 = id(), T2 = id(), STAFF = id(), SITE = id();

let admin: postgres.Sql, db: postgres.Sql;
const q = async (text: string) => (await db.unsafe(text)) as unknown as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  const url = new URL(env().DATABASE_URL_MIGRATE);
  admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${DB} with (force)`);
  await admin.unsafe(`create database ${DB}`);
  url.pathname = `/${DB}`;
  db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const at = journal.findIndex((t) => t.startsWith("0013"));
  for (const tag of journal.slice(0, at)) for (const s of steps(tag)) if (s.trim()) await db.unsafe(s);
  await q(`insert into schools (id, slug, name) values ('${A}','a','A'),('${B}','b','B');
    insert into platform_staff (id, email, name, role, password_hash) values ('${STAFF}','s@x.test','Sana','support','x');`);
  const enq = (school: string, name: string, phone: string, status: string, when: string, notes = "null") =>
    `insert into enquiries (id, school_id, student_name, parent_name, phone, status, notes, created_at, updated_at) values ('${id()}','${school}','${name}','P','${phone}','${status}',${notes},'${when}','${when}');`;
  await q(enq(A, "One", "+91 98765 43210", "new", "2026-01-05T10:00:00Z") + enq(A, "Two", "9876543211", "closed", "2026-02-05T10:00:00Z", "'chose another'") + enq(A, "Old", "9876543212", "admitted", "2025-12-31T17:00:00Z")
    + enq(A, "NewYear", "9876543213", "visited", "2025-12-31T19:00:00Z") + enq(B, "Other", "9876543214", "contacted", "2026-03-01T10:00:00Z"));
  await q(`insert into school_sites (id, school_id, draft, published, published_at, template_key) values ('${SITE}','${A}','{"pages":[]}','{"pages":[1]}','2026-04-01','modern'),('${id()}','${B}','{}',null,null,'classic');
    insert into support_tickets (id, school_id, subject, status, created_at) values ('${T2}','${A}','second','pending','2026-02-02'),('${T1}','${B}','first','open','2026-02-01');
    insert into support_messages (id, school_id, ticket_id, author_staff_id, body, created_at) values ('${id()}','${A}','${T2}','${STAFF}','hi','2026-02-03');
    insert into data_exports (id, school_id, scope, label, file_key) values ('${id()}','${A}','school','All','k');`);
  for (const s of steps(journal[at]!)) if (s.trim()) await db.unsafe(s);
  const dirs = [join(REPO, "packages/db/sql"), ...readdirSync(join(REPO, "features")).sort().map((n) => join(REPO, "features", n, "sql"))].filter(existsSync);
  for (const d of dirs) for (const f of readdirSync(d).filter((x) => x.endsWith(".sql")).sort()) await db.unsafe(readFileSync(join(d, f), "utf8"));
}, 120_000);

afterAll(async () => { await db.end(); await admin.unsafe(`drop database if exists ${DB} with (force)`); await admin.end(); });

describe("migration 0013", () => {
  it("gives every enquiry a reference per IST year and the next number follows", async () => {
    const rows = await q(`select student_name as n, ref from enquiries where school_id='${A}' order by created_at`);
    expect(rows.map((r) => `${r.n} ${r.ref}`)).toEqual(["Old E-2025-0001", "NewYear E-2026-0001", "One E-2026-0002", "Two E-2026-0003"]);
    expect((await q(`select ref from enquiries where school_id='${B}'`))[0]!.ref).toBe("E-2026-0001");
    expect((await q(`select value from sequences where school_id='${A}' and key='enquiry:2026'`))[0]!.value).toBe(3);
  });
  it("keeps stages, marks closed ones, finds phones and starts the timeline", async () => {
    const [two] = await q(`select * from enquiries where student_name='Two'`);
    expect(two).toMatchObject({ status: "closed", close_reason: "Not recorded", reached: "new", phone_key: "9876543211" });
    expect((await q(`select phone_key as k, first_contact_at as f from enquiries where student_name='One'`))[0]).toEqual({ k: "9876543210", f: null });
    expect((await q(`select kind from enquiry_events where enquiry_id='${two!.id}' order by kind`)).map((r) => r.kind)).toEqual(["created", "note"]);
  });
  it("makes version 1 of live sites only, and live sites keep their teachers", async () => {
    expect(await q(`select school_id, number, template_key from site_versions`)).toEqual([{ school_id: A, number: 1, template_key: "modern" }]);
    expect((await q(`select settings from school_sites where id='${SITE}'`))[0]!.settings).toEqual({ teachersChecked: true });
  });
  it("numbers old tickets in order and never tells about them again", async () => {
    expect((await q(`select id, number, reply_due_at is not null as due, overdue_told_at is not null as told from support_tickets order by number`)))
      .toEqual([{ id: T1, number: 1001, due: true, told: true }, { id: T2, number: 1002, due: true, told: true }]);
    expect((await q(`select staff_name, told_at is not null as told from support_messages`))[0]).toEqual({ staff_name: "Sana", told: true });
    expect(Number((await q(`select nextval('support_ticket_number') as n`))[0]!.n)).toBe(1003);
  });
  it("lets two schools claim one hostname but only one hold it", async () => {
    const add = (s: string, status: string) => q(`insert into school_domains (id, school_id, hostname, verify_token, status) values ('${id()}','${s}','www.x.in','t','${status}')`);
    await add(A, "verified"); await add(B, "pending");
    await expect(q(`update school_domains set status='verified' where school_id='${B}'`)).rejects.toThrow(/school_domains_verified_hostname/);
  });
  it("leaves the school role no way into staff notes", async () => {
    expect((await q(`select has_table_privilege('app_school','support_notes','select') as ok`))[0]!.ok).toBe(false);
  });
});
