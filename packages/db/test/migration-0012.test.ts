// Acceptance 28 and 39: migration 0012 on data shaped like the old schema, rule by rule (docs/COMMUNICATION-PRD.md section 11).
import { createHash, randomUUID as id } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@smw/config";

const REPO = resolve(import.meta.dirname, "../../..");
const MIG = join(REPO, "packages/db/migrations");
const DB = "smw_t_migration_0012";
const journal = JSON.parse(readFileSync(join(MIG, "meta/_journal.json"), "utf8")).entries as { tag: string }[];
const steps = (file: string) => readFileSync(join(MIG, `${file}.sql`), "utf8").split("--> statement-breakpoint");

function postSql() {
  const dirs = [join(REPO, "packages/db/sql"), ...readdirSync(join(REPO, "features")).sort().map((n) => join(REPO, "features", n, "sql"))];
  return dirs.filter(existsSync).flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".sql")).sort().map((f) => join(d, f)));
}

let admin: postgres.Sql, db: postgres.Sql;
const q = async (text: string) => (await db.unsafe(text)) as unknown as Record<string, any>[];
const n = async (text: string) => Number((await q(text))[0].c);
const hash = async () => {
  const out: string[] = [];
  for (const t of ["student_attendance", "staff_attendance", "period_attendance", "leave_requests", "pay_runs"])
    out.push(t + ":" + createHash("md5").update(JSON.stringify(await q(`select * from ${t} order by id`))).digest("hex"));
  return out;
};

type School = { id: string; slug: string; admin: string; teacher: string; s1: string; s2: string; s3: string; sNoRow: string; classA: string; classB: string; students: string[]; t: Record<string, string>; staff: number };
const S: School[] = [];
const days = (d: number) => `((now() at time zone 'Asia/Kolkata')::date + (${d}))`;
const at = (d: number) => `(${days(d)}::text || ' 00:00+05:30')::timestamptz`;
let before: string[];

async function seed(slug: string): Promise<School> {
  const s = { id: id(), slug, admin: id(), teacher: id(), s1: id(), s2: id(), s3: id(), sNoRow: id(), classA: id(), classB: id(), students: [id(), id(), id(), id()], t: {} } as School;
  const u = (uid: string, role: string, name: string, status = "active") => `insert into users (id, school_id, role, login_id, name, status) values ('${uid}','${s.id}','${role}','${role}-${uid.slice(0, 6)}','${name}','${status}');`;
  await q(`insert into schools (id, slug, name) values ('${s.id}','${slug}','School ${slug}');
    insert into classes (id, school_id, name, grade) values ('${s.classA}','${s.id}','Class 1',1),('${s.classB}','${s.id}','Class 2',2);
    ${u(s.admin, "admin", "Asha Admin")} ${u(s.teacher, "teacher", "Tara Teacher")} ${u(s.s1, "student", "Stu One")} ${u(s.s2, "student", "Stu Two")} ${u(s.s3, "student", "Stu Three")} ${u(s.sNoRow, "student", "Orphan Login")}
    ${u(s.students[3], "student", "Stu Left")}`);
  const stu = (sid: string, uid: string, no: string, nm: string, cls: string, status = "active") =>
    `insert into students (id, school_id, admission_no, name, class_id, status, user_id) values ('${sid}','${s.id}','${no}','${nm}','${cls}','${status}','${uid}');`;
  await q(stu(s.students[0], s.s1, "A1", "Stu One", s.classA) + stu(s.students[1], s.s2, "A2", "Stu Two", s.classA) + stu(s.students[2], s.s3, "A3", "Stu Three", s.classB) + stu(id(), s.students[3], "A4", "Stu Left", s.classA, "left"));
  s.staff = 2;

  // Notices of every old audience, public + staff, class with and without a class.
  const ann = (key: string, audience: string, cls: string | null, pub: boolean, pinned: boolean, ageDays: number) => {
    const aid = (s.t["a_" + key] = id());
    return `insert into announcements (id, school_id, title, body, audience, class_id, is_public, pinned, published_at, created_by) values ('${aid}','${s.id}','${key}','body','${audience}',${cls ? `'${cls}'` : "null"},${pub},${pinned},now() - interval '${ageDays} days','${s.admin}');`;
  };
  await q(ann("all_public", "all", null, true, false, 3) + ann("all_private", "all", null, false, true, 5) + ann("staff_public", "staff", null, true, false, 2) + ann("parents", "parents", null, false, false, 4)
    + ann("students", "students", null, false, false, 6) + ann("class", "class", s.classA, false, false, 7) + ann("class_null", "class", null, false, false, 8) + ann("old", "all", null, true, false, 120));

  // Threads: staff only; staff + one student; staff + two students; student without a student row; deleted sender.
  const thread = async (key: string, members: string[], senders: (string | null)[]) => {
    const tid = (s.t["t_" + key] = id());
    await q(`insert into message_threads (id, school_id, subject, kind, created_by, last_message_at) values ('${tid}','${s.id}','${key}','direct','${s.admin}', now());`);
    for (const m of members) await q(`insert into thread_members (id, school_id, thread_id, user_id, last_read_at) values ('${id()}','${s.id}','${tid}','${m}', ${m === s.s1 && key === "one" ? "now()" : "null"});`);
    for (const m of senders) await q(`insert into messages (id, school_id, thread_id, sender_id, body) values ('${id()}','${s.id}','${tid}',${m ? `'${m}'` : "null"},'hello');`);
  };
  await thread("staff", [s.admin, s.teacher], [s.admin, s.teacher]);
  await thread("one", [s.admin, s.s1], [s.admin, s.s1]);
  await thread("two", [s.admin, s.s1, s.s2], [s.admin, s.s2]);
  await thread("norow", [s.teacher, s.sNoRow], [s.sNoRow]);
  await thread("deleted", [s.admin, s.teacher], [null, s.admin]);

  // Notifications of every kind; message ones read and unread (one older than the member's last read, one newer).
  const note = (uid: string, kind: string, title: string, href: string | null, read: boolean, ago: string) =>
    `insert into notifications (id, school_id, user_id, kind, title, href, read_at, created_at) values ('${id()}','${s.id}','${uid}','${kind}','${title}',${href ? `'${href}'` : "null"},${read ? "now()" : "null"}, now() - interval '${ago}');`;
  await q(["announcement", "fee_due", "result", "assignment", "system"].map((k, i) => note(s.s1, k, k, null, i % 2 === 0, "1 day")).join("")
    + note(s.s1, "message", "msg-old-unread", `/app/messages?thread=${s.t.t_one}`, false, "2 hours") // member read at "now" -> becomes read
    + note(s.admin, "message", "msg-read", `/app/messages?thread=${s.t.t_staff}`, true, "3 hours")
    + note(s.admin, "message", "msg-unread", `/app/messages?thread=${s.t.t_staff}`, false, "1 hour"));
  await q(`insert into notification_prefs (id, school_id, user_id, email_digest) values ('${id()}','${s.id}','${s.admin}',false),('${id()}','${s.id}','${s.teacher}',true);`);

  // Events of every audience, then holidays.
  const ev = (key: string, audience: string, cls: string | null, pub: boolean, start: number) => {
    const eid = (s.t["e_" + key] = id());
    return `insert into events (id, school_id, title, starts_at, audience, class_id, is_public, created_by) values ('${eid}','${s.id}','${key}',${at(start)},'${audience}',${cls ? `'${cls}'` : "null"},${pub},'${s.admin}');`;
  };
  await q(ev("all", "all", null, true, 5) + ev("staff", "staff", null, true, 6) + ev("class", "class", s.classA, false, 7) + ev("parents", "parents", null, false, 8) + ev("past", "all", null, false, -10));
  const hol = (key: string, from: number, to: number) => {
    const eid = (s.t["h_" + key] = id());
    return `insert into events (id, school_id, title, starts_at, ends_at, all_day, audience, is_holiday, created_by) values ('${eid}','${s.id}','${key}',${at(from)},${at(to)},true,'all',true,'${s.admin}');`;
  };
  await q(hol("future", 20, 22) + hol("past_clean", -40, -39) + hol("past_marked", -20, -18) + hol("pay", -75, -75) + hol("known", 30, 30));
  await q(`insert into attendance_holidays (id, school_id, date, name) values ('${id()}','${s.id}',${days(30)},'Already there');`);
  // Day -20 marked, day -19 approved leave, -18 clean. Month of day -75 has a paid payroll.
  await q(`insert into staff_attendance (id, school_id, user_id, date, status) values ('${id()}','${s.id}','${s.teacher}',${days(-20)},'present');
    insert into leave_requests (id, school_id, kind, user_id, requested_by, from_date, to_date, reason, status) values ('${id()}','${s.id}','staff','${s.teacher}','${s.teacher}',${days(-19)},${days(-19)},'ill','approved');
    insert into pay_runs (id, school_id, kind, month, label, status) values ('${id()}','${s.id}','salary',date_trunc('month', ${days(-75)})::date,'run','paid');`);

  // Custom roles and ready-made templates.
  const role = (name: string, grants: string[], tpl: boolean) => `insert into school_roles (id, school_id, name, description, base, is_template, grants) values ('${id()}','${s.id}','${name}','old','staff',${tpl},ARRAY[${grants.map((g) => `'${g}'`).join(",")}]::text[]);`;
  await q(role("Notice writer", ["home:view", "announcements:write", "notifications:send"], false) + role("Plain custom", ["home:view", "notifications:send"], false)
    + role("Front office", ["home:view", "students:read", "announcements:publish"], true) + role("Teacher template", ["home:view", "announcements:write"], true));
  return s;
}

beforeAll(async () => {
  const e = env();
  admin = postgres(e.DATABASE_URL_MIGRATE, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${DB} with (force)`);
  await admin.unsafe(`create database ${DB}`);
  const url = new URL(e.DATABASE_URL_MIGRATE); url.pathname = `/${DB}`;
  db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  for (const { tag } of journal) { if (tag.startsWith("0012")) break; for (const st of steps(tag)) await db.unsafe(st); }
  S.push(await seed("alpha"), await seed("beta"));
  before = await hash();
  const last = journal[journal.length - 1].tag;
  expect(last.startsWith("0012")).toBe(true);
  await db.begin(async (tx) => { for (const st of steps(last)) await tx.unsafe(st); });
  for (const f of postSql()) await db.unsafe(readFileSync(f, "utf8"));
});
afterAll(async () => {
  await db?.end({ timeout: 5 });
  await admin?.unsafe(`drop database if exists ${DB} with (force)`);
  await admin?.end({ timeout: 5 });
});

const each = (fn: (s: School) => Promise<void>) => async () => { for (const s of S) await fn(s); };
const row = async (table: string, idv: string) => (await q(`select * from ${table} where id = '${idv}'`))[0];

describe("migration 0012 (PRD section 11)", () => {
  it("1 notices: published, audience mapped, website only for public+all", each(async (s) => {
    expect(await n(`select count(*) c from announcements where school_id='${s.id}' and state <> 'published'`)).toBe(0);
    const aud = async (k: string) => (await row("announcements", s.t["a_" + k])).audience;
    expect(await aud("all_public")).toEqual({ include: [{ type: "everyone" }], exclude: [] });
    expect(await aud("staff_public")).toEqual({ include: [{ type: "staff" }], exclude: [] });
    expect(await aud("parents")).toEqual({ include: [{ type: "families" }], exclude: [] });
    expect(await aud("students")).toEqual({ include: [{ type: "families" }], exclude: [] });
    expect(await aud("class_null")).toEqual({ include: [{ type: "families" }], exclude: [] });
    expect(await aud("class")).toEqual({ include: [{ type: "class", id: s.classA }], exclude: [] });
    expect((await row("announcements", s.t.a_all_public)).website).toBe(true);
    expect((await row("announcements", s.t.a_old)).website).toBe(true);
    for (const k of ["staff_public", "all_private", "parents"]) expect((await row("announcements", s.t["a_" + k])).website).toBe(false);
    expect((await row("announcements", s.t.a_all_private)).pinned_until).not.toBeNull();
    expect((await row("announcements", s.t.a_all_public)).number).toBeNull();
  }));
  it("1 notices: recipients for the last 90 days only, marked before tracking, nobody who left", each(async (s) => {
    const expected: Record<string, number> = { all_public: 5, all_private: 5, staff_public: 2, parents: 3, students: 3, class: 2, class_null: 3, old: 0 };
    for (const [k, c] of Object.entries(expected)) expect(await n(`select count(*) c from announcement_recipients where announcement_id='${s.t["a_" + k]}'`), k).toBe(c);
    expect(await n(`select count(*) c from announcement_recipients where school_id='${s.id}' and not before_tracking`)).toBe(0);
    expect(await n(`select count(*) c from announcement_recipients where school_id='${s.id}' and seen_at is not null`)).toBe(0);
    expect(await n(`select count(*) c from announcement_recipients where school_id='${s.id}' and name='Stu Left'`)).toBe(0);
    expect(await n(`select count(*) c from (select announcement_id, person_key from announcement_recipients group by 1,2 having count(*)>1) x`)).toBe(0);
  }));
  it("2 messages: kind from members, one student, several families read only, nothing deleted", each(async (s) => {
    const t = async (k: string) => row("message_threads", s.t["t_" + k]);
    expect(await t("staff")).toMatchObject({ kind: "staff", student_id: null, state: "open" });
    expect(await t("deleted")).toMatchObject({ kind: "staff", state: "open" });
    expect(await t("one")).toMatchObject({ kind: "student", student_id: s.students[0], state: "open" });
    for (const k of ["two", "norow"]) {
      const r = await t(k);
      expect(r.kind, k).toBe("legacy"); expect(r.state).toBe("closed"); expect(r.closed_reason).toMatch(/read only/);
    }
    expect(await n(`select count(*) c from message_threads where school_id='${s.id}'`)).toBe(5);
    expect(await n(`select count(*) c from messages where school_id='${s.id}'`)).toBe(9);
    expect(await n(`select count(*) c from messages where school_id='${s.id}' and sender_name='Removed user'`)).toBe(1);
    expect(await n(`select count(*) c from messages m join users u on u.id=m.sender_id where m.school_id='${s.id}' and m.sender_name <> u.name`)).toBe(0);
    expect(await n(`select count(*) c from thread_members where school_id='${s.id}' and (name is null or role is null)`)).toBe(0);
  }));
  it("3 notifications: topic by kind, message rows get a subject, read follows the member", each(async (s) => {
    const topic = async (k: string) => (await q(`select distinct topic from notifications where school_id='${s.id}' and title='${k}'`)).map((r) => r.topic);
    expect(await topic("announcement")).toEqual(["notice.published"]);
    expect(await topic("fee_due")).toEqual(["fees.due"]);
    expect(await topic("result")).toEqual(["exam.result"]);
    expect(await topic("assignment")).toEqual(["homework.new"]);
    expect((await q(`select distinct topic from notifications where school_id='${s.id}' and title like 'msg-%'`)).map((r) => r.topic)).toEqual(["message.new"]);
    expect(await topic("system")).toEqual(["work.update"]);
    expect(await n(`select count(*) c from notifications where school_id='${s.id}' and title like 'msg-%' and (subject_type<>'thread' or subject_id is null or not private_body)`)).toBe(0);
    const bytitle = async (t: string) => (await q(`select * from notifications where school_id='${s.id}' and title='${t}'`))[0];
    expect((await bytitle("msg-old-unread")).read_at).not.toBeNull(); // member had read past it
    expect((await bytitle("msg-unread")).read_at).toBeNull();
    expect((await bytitle("msg-read")).read_at).not.toBeNull();
    expect(await n(`select count(*) c from notifications where school_id='${s.id}'`)).toBe(10);
  }));
  it("5 preferences: digest off stays off for all email", each(async (s) => {
    const p = async (uid: string) => (await q(`select * from notification_prefs where user_id='${uid}'`))[0];
    const off = await p(s.admin);
    expect(Object.keys(off.groups).sort()).toEqual(["attendance", "calendar", "exams", "fees", "homework", "messages", "notices", "services", "work"]);
    for (const g of Object.values(off.groups) as any[]) expect(g).toEqual({ push: true, email: "off" });
    expect((await p(s.teacher)).groups).toEqual({});
  }));
  it("events: audience mapped, people made, public only for public+all", each(async (s) => {
    const e = async (k: string) => row("events", s.t["e_" + k]);
    expect((await e("all")).audience.include[0].type).toBe("everyone");
    expect((await e("staff")).audience.include[0].type).toBe("staff");
    expect((await e("parents")).audience.include[0].type).toBe("families");
    expect((await e("class")).audience.include[0]).toEqual({ type: "class", id: s.classA });
    expect((await e("all")).is_public).toBe(true);
    expect((await e("staff")).is_public).toBe(false);
    const people = async (k: string) => n(`select count(*) c from event_people where event_id='${s.t["e_" + k]}'`);
    expect(await people("all")).toBe(5); expect(await people("staff")).toBe(2); expect(await people("parents")).toBe(3); expect(await people("class")).toBe(2);
  }));
  it("4 holidays: clean days added, a day with marks, leave or pay never added, listed for the admin", each(async (s) => {
    const has = async (d: number) => n(`select count(*) c from attendance_holidays where school_id='${s.id}' and date=${days(d)}`);
    for (const d of [20, 21, 22, -40, -39, -18]) expect(await has(d), `day ${d}`).toBe(1);
    for (const d of [-20, -19, -75]) expect(await has(d), `day ${d}`).toBe(0);
    expect(await n(`select count(*) c from attendance_holidays where school_id='${s.id}' and date=${days(30)}`)).toBe(1);
    expect((await q(`select name from attendance_holidays where school_id='${s.id}' and date=${days(30)}`))[0].name).toBe("Already there");
    expect(await n(`select count(*) c from attendance_holidays where school_id='${s.id}' and span_id='${s.t.h_future}'`)).toBe(3);
    // Fully handled spans leave the events table; spans with a blocked day stay so nothing is lost.
    for (const k of ["future", "past_clean", "known"]) expect(await n(`select count(*) c from events where id='${s.t["h_" + k]}'`), k).toBe(0);
    for (const k of ["past_marked", "pay"]) expect(await n(`select count(*) c from events where id='${s.t["h_" + k]}'`), k).toBe(1);
    expect(await n(`select count(*) c from notifications where school_id='${s.id}' and user_id='${s.admin}' and title='Check these holidays'`)).toBe(2);
    expect(await n(`select count(*) c from notifications where school_id='${s.id}' and user_id<>'${s.admin}' and title='Check these holidays'`)).toBe(0);
  }));
  it("6 roles: write became draft+publish, send gone, templates fixed, new roles once, read grants everywhere", each(async (s) => {
    const g = async (name: string) => (await q(`select * from school_roles where school_id='${s.id}' and name='${name}'`))[0];
    const w = (await g("Notice writer")).grants as string[];
    expect(w).toEqual(expect.arrayContaining(["announcements:draft", "announcements:publish", "home:view"]));
    expect(w).not.toContain("announcements:write"); expect(w).not.toContain("notifications:send");
    expect((await g("Plain custom")).grants).not.toContain("notifications:send");
    const fo = await g("Front office");
    expect(fo.grants).toEqual(expect.arrayContaining(["requests:office", "meetings:use"])); expect(fo.grants).not.toContain("announcements:publish");
    expect(fo.description).toBe("Looks up students, answers enquiries and posts notices.");
    expect((await g("Teacher template")).grants).toEqual(expect.arrayContaining(["announcements:draft", "announcements:publish"]));
    expect((await g("Safeguarding lead")).grants).toEqual(expect.arrayContaining(["messages:safeguard", "students:read"]));
    expect((await g("Coordinator")).grants).toEqual(expect.arrayContaining(["announcements:approve", "events:write"]));
    for (const name of ["Safeguarding lead", "Coordinator"]) expect(await n(`select count(*) c from school_roles where school_id='${s.id}' and name='${name}'`)).toBe(1);
    expect(await n(`select count(*) c from school_roles where school_id='${s.id}' and not (grants @> ARRAY['announcements:read','events:read','requests:use'])`)).toBe(0);
  }));
  it("37 nothing of one school lands in the other", async () => {
    for (const [t, via] of [["announcement_recipients", "announcements"], ["event_people", "events"]] as const) {
      const col = t === "announcement_recipients" ? "announcement_id" : "event_id";
      expect(await n(`select count(*) c from ${t} r join ${via} p on p.id = r.${col} where r.school_id <> p.school_id`), t).toBe(0);
    }
    expect(await n(`select count(*) c from announcement_recipients r join users u on u.id = r.user_id where r.school_id <> u.school_id`)).toBe(0);
    expect(await n(`select count(*) c from event_people r join users u on u.id = r.user_id where r.school_id <> u.school_id`)).toBe(0);
    expect(await n(`select count(*) c from attendance_holidays h join events e on e.id = h.span_id where h.school_id <> e.school_id`)).toBe(0);
    expect(await n(`select count(*) c from notifications nn join users u on u.id = nn.user_id where nn.school_id <> u.school_id`)).toBe(0);
    expect(await n(`select count(*) c from thread_members m join message_threads t on t.id = m.thread_id where m.school_id <> t.school_id`)).toBe(0);
    const [a, b] = S;
    for (const t of ["announcement_recipients", "event_people", "attendance_holidays", "notifications", "message_threads", "school_roles"])
      expect(await n(`select count(*) c from ${t} where school_id='${a.id}'`), t).toBe(await n(`select count(*) c from ${t} where school_id='${b.id}'`));
  });
  it("28 attendance, leave and payroll rows are byte for byte unchanged", async () => {
    expect(await hash()).toEqual(before);
  });
  it("39 running twice changes nothing: post SQL again is a no-op, 0012 again refuses", async () => {
    const snap = async () => [await n("select count(*) c from announcement_recipients"), await n("select count(*) c from attendance_holidays"), await n("select count(*) c from school_roles"), await n("select count(*) c from event_people"), ...(await hash())].join("|");
    const was = await snap();
    for (const f of postSql()) await db.unsafe(readFileSync(f, "utf8"));
    await expect(db.begin(async (tx) => { for (const st of steps(journal[journal.length - 1].tag)) await tx.unsafe(st); })).rejects.toThrow();
    expect(await snap()).toBe(was);
  });
});
