// Migration 0014 on data shaped like the old schema (docs/ADMISSIONS-PRD.md 14.2 item 14).
import { randomUUID as id } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@smw/config";

const REPO = resolve(import.meta.dirname, "../../..");
const MIG = join(REPO, "packages/db/migrations");
const DB = "smw_t_migration_0014";
const journal = (JSON.parse(readFileSync(join(MIG, "meta/_journal.json"), "utf8")).entries as { tag: string }[]).map((e) => e.tag);
const steps = (tag: string) => readFileSync(join(MIG, `${tag}.sql`), "utf8").split("--> statement-breakpoint");
const A = id(), B = id(), Y1 = id(), Y2 = id(), Y0 = id();
const S = { left: id(), alum: id(), active: id(), leftNoDate: id(), leftLater: id(), otherLeft: id() };

let admin: postgres.Sql, db: postgres.Sql;
const q = async (text: string) => (await db.unsafe(text)) as unknown as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  const url = new URL(env().DATABASE_URL_MIGRATE);
  admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${DB} with (force)`);
  await admin.unsafe(`create database ${DB}`);
  url.pathname = `/${DB}`;
  db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const at = journal.findIndex((t) => t.startsWith("0014"));
  for (const tag of journal.slice(0, at)) for (const s of steps(tag)) if (s.trim()) await db.unsafe(s);
  await q(`insert into schools (id, slug, name) values ('${A}','a','A'),('${B}','b','B');
    insert into academic_years (id, school_id, name, starts_on, ends_on, is_current) values
      ('${Y0}','${A}','2025-26','2025-04-01','2026-03-31',false),('${Y1}','${A}','2026-27','2026-04-01','2027-03-31',true),('${Y2}','${A}','2027-28','2027-04-01','2028-03-31',false);`);
  const stu = (sid: string, no: string, status: string, leftOn: string | null) =>
    `insert into students (id, school_id, admission_no, name, status, left_on) values ('${sid}','${A}','${no}','${no}','${status}',${leftOn ? `'${leftOn}'` : "null"});`;
  const enr = (sid: string, year: string, outcome: string) =>
    `insert into student_enrollments (id, school_id, student_id, year_id, outcome) values ('${id()}','${A}','${sid}','${year}','${outcome}');`;
  await q(stu(S.left, "L1", "left", "2026-09-30") + stu(S.alum, "G1", "alumni", "2026-06-01") + stu(S.active, "C1", "active", null)
    + stu(S.leftNoDate, "L2", "left", null) + stu(S.leftLater, "L3", "left", "2026-08-01")
    + `insert into students (id, school_id, admission_no, name, status, left_on) values ('${S.otherLeft}','${B}','B1','B1','left','2026-09-01');`
    + enr(S.left, Y1, "studying") + enr(S.alum, Y1, "studying") + enr(S.active, Y1, "studying") + enr(S.leftNoDate, Y1, "studying")
    + enr(S.leftLater, Y2, "studying") + enr(S.left, Y0, "promoted"));
  await q(`insert into student_enrollments (id, school_id, student_id, year_id, outcome) values ('${id()}','${B}','${S.otherLeft}','${Y1}','studying')`).catch(() => undefined);
  for (const s of steps(journal[at]!)) if (s.trim()) await db.unsafe(s);
}, 120_000);

afterAll(async () => { await db.end(); await admin.unsafe(`drop database if exists ${DB} with (force)`); await admin.end(); });

const outcomes = async () => Object.fromEntries((await q(`select s.admission_no n, y.name y, e.outcome o from student_enrollments e join students s on s.id=e.student_id join academic_years y on y.id=e.year_id order by 1,2`)).map((r) => [`${r.n} ${r.y}`, r.o]));

describe("migration 0014", () => {
  it("adds the columns and leaves every student's status alone", async () => {
    expect((await q(`select column_name from information_schema.columns where table_name='students' and column_name in ('left_reason','left_note','access_until','pen','joins_on','joins_year_id','joins_section_id') order by 1`)).map((r) => r.column_name))
      .toEqual(["access_until", "joins_on", "joins_section_id", "joins_year_id", "left_note", "left_reason", "pen"]);
    expect((await q(`select admission_no n, status s from students order by 1`)).map((r) => `${r.n} ${r.s}`)).toEqual(["B1 left", "C1 active", "G1 alumni", "L1 left", "L2 left", "L3 left"]);
  });
  it("closes the enrolment of a left student as left and an alumnus as graduated", async () => {
    const o = await outcomes();
    expect(o["L1 2026-27"]).toBe("left");
    expect(o["G1 2026-27"]).toBe("graduated");
    expect(o["L2 2026-27"]).toBe("left"); // no date: closed
  });
  it("leaves active students, earlier outcomes and later-year rows untouched", async () => {
    const o = await outcomes();
    expect(o["C1 2026-27"]).toBe("studying");
    expect(o["L1 2025-26"]).toBe("promoted");
    expect(o["L3 2027-28"]).toBe("studying"); // a year that began after they left
  });
  it("gives students who had already left 90 days of access from today (IST), and nobody else", async () => {
    const [{ d }] = (await q(`select ((now() at time zone 'Asia/Kolkata')::date + 90)::text d`)) as { d: string }[];
    const until = Object.fromEntries((await q(`select admission_no n, access_until::text u from students order by 1`)).map((r) => [r.n, r.u]));
    for (const n of ["L1", "L2", "L3", "G1", "B1"]) expect(until[n], n).toBe(d); // left, alumni, no last day, another school
    expect(until["C1"]).toBeNull();
    // a joining student added after the migration has none either: only the data step writes it
    await q(`insert into students (id, school_id, admission_no, name, status, joins_on) values ('${id()}','${A}','J1','J1','joining','2027-04-01')`);
    expect((await q(`select access_until from students where admission_no='J1'`))[0]!.access_until).toBeNull();
    await q(`delete from students where admission_no='J1'`);
  });
  it("runs twice safely", async () => {
    const before = await outcomes();
    for (const s of steps(journal.find((t) => t.startsWith("0014"))!)) {
      // the column steps are not repeatable; the data step is
      if (/^\s*(UPDATE|--)/i.test(s.trim())) await db.unsafe(s);
    }
    expect(await outcomes()).toEqual(before);
    expect((await q(`select count(*)::int n from students where joins_on is not null or pen is not null or left_reason is not null`))[0]!.n).toBe(0);
  });
});
