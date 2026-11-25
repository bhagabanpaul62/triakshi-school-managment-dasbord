// Who an audience reaches. Reads other modules' tables by raw SQL only (no feature imports); optional tables go through to_regclass.
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ForbiddenError, SchoolService, type Ctx } from "@smw/feature-kit";
import { audienceField, type Audience, type AudienceRule, type Reached } from "./audience-rules";
import notificationsFeature from "./feature";

const OPTIONAL = ["student_houses", "student_transport", "student_subjects", "class_subjects", "section_teachers", "fee_invoices", "comm_groups", "routes", "route_stops"] as const;
type Has = Record<(typeof OPTIONAL)[number], boolean>;
const rows = async <T>(tx: Tx, q: SQL) => [...(await tx.execute(q))] as T[];
const ids = (list: string[]) => sql.join(list.map((i) => sql`${i}::uuid`), sql`, `);
const NO = sql`false`;
export const BUILT_IN_ROLES = { admin: "Admin", accountant: "Accountant", teacher: "Teacher" } as const;
const classLabel = (col: SQL) => sql`(case when ${col} ilike 'class %' then ${col} else 'Class ' || ${col} end)`;

async function tablesPresent(tx: Tx): Promise<Has> {
  const found = await rows<{ t: string; ok: boolean }>(tx, sql`select t, to_regclass(t) is not null as ok from unnest(${sql.raw(`array[${OPTIONAL.map((t) => `'${t}'`).join(",")}]::text[]`)}) as t`);
  return Object.fromEntries(found.map((f) => [f.t, f.ok])) as Has;
}

interface Gate { has: Has }

function rulePred(r: AudienceRule, g: Gate): SQL {
  const { has } = g;
  switch (r.type) {
    case "everyone": return sql`true`;
    case "families": return sql`p.is_student`;
    case "staff": return sql`not p.is_student`;
    case "class": return sql`(p.is_student and p.class_id = ${r.id}::uuid)`;
    case "section": return sql`(p.is_student and p.section_id = ${r.id}::uuid)`;
    case "student": return sql`(p.student_id = ${r.id}::uuid)`;
    case "person": return sql`(p.login_user = ${r.id}::uuid)`;
    case "house": return has.student_houses ? sql`exists (select 1 from student_houses x where x.student_id = p.student_id and x.house_id = ${r.id}::uuid)` : NO;
    case "route": return has.student_transport ? sql`exists (select 1 from student_transport x where x.student_id = p.student_id and x.route_id = ${r.id}::uuid)` : NO;
    case "stop": return has.student_transport ? sql`exists (select 1 from student_transport x where x.student_id = p.student_id and x.stop_id = ${r.id}::uuid)` : NO;
    case "group": return NO; // expandGroups already replaced every group; one left over is unknown or nested and reaches nobody
    case "subject": {
      // A compulsory class subject counts for the whole class; an elective only for students it was chosen for.
      const own = [
        has.student_subjects ? sql`exists (select 1 from student_subjects x where x.student_id = p.student_id and x.subject_id = ${r.id}::uuid and x.year_id in (select id from cur))` : NO,
        has.class_subjects ? sql`exists (select 1 from class_subjects x where x.class_id = p.class_id and x.subject_id = ${r.id}::uuid and not x.is_elective)` : NO,
      ];
      return sql`(p.is_student ${r.sectionId ? sql`and p.section_id = ${r.sectionId}::uuid` : sql``} and (${sql.join(own, sql` or `)}))`;
    }
    case "role": return sql`(not p.is_student and (p.role = ${r.id} or p.role_id::text = ${r.id}))`;
    case "teachers_of": {
      const where = r.sectionId ? sql`and s.id = ${r.sectionId}::uuid` : r.classId ? sql`and s.class_id = ${r.classId}::uuid` : sql``;
      const taught = has.section_teachers ? sql`union select t.teacher_id from section_teachers t join sections s on s.id = t.section_id where s.year_id in (select id from cur) ${where}` : sql``;
      return sql`(not p.is_student and p.login_user in (select s.class_teacher_id from sections s where s.class_teacher_id is not null and s.year_id in (select id from cur) ${where} ${taught}))`;
    }
    case "fee_overdue":
      return has.fee_invoices
        ? sql`(p.is_student and exists (select 1 from fee_invoices f where f.student_id = p.student_id and f.status = 'issued'
            and f.due_date < (now() at time zone 'Asia/Kolkata')::date - ${r.days}::int
            and f.paid_paise < f.gross_paise - f.concession_paise - f.credited_paise + f.late_paise))`
        : NO;
  }
}

function audiencePred(a: Audience, g: Gate): SQL {
  const any = (rules: AudienceRule[]) => rules.length ? sql`(${sql.join(rules.map((r) => rulePred(r, g)), sql` or `)})` : NO;
  return sql`(${any(a.include)} and not ${any(a.exclude)})`;
}

const PEOPLE = sql`
  cur as (select id from academic_years where is_current limit 1),
  people as (
    select s.id as student_id, s.class_id, s.section_id, s.name, case when u.status = 'active' then u.id end as user_id, u.id as login_user,
      coalesce(${classLabel(sql`c.name`)}, 'Student') || coalesce(' ' || sec.name, '') as label, true as is_student, null::text as role, null::uuid as role_id,
      case when u.id is null then 'No login yet' when u.status <> 'active' then 'Login is switched off'
           when coalesce(u.email, '') = '' and not exists (select 1 from push_subscriptions ps where ps.user_id = u.id) then 'No email and no phone app, so only the in-app list shows it' end as why
    from students s left join classes c on c.id = s.class_id left join sections sec on sec.id = s.section_id left join users u on u.id = s.user_id
    where s.status = 'active'
    union all
    select null, null, null, u.name, u.id, u.id,
      coalesce(r.name, case u.role when 'admin' then 'Admin' when 'accountant' then 'Accountant' when 'teacher' then 'Teacher' else 'Staff' end), false, u.role, u.role_id,
      case when coalesce(u.email, '') = '' and not exists (select 1 from push_subscriptions ps where ps.user_id = u.id) then 'No email and no phone app, so only the in-app list shows it' end
    from users u left join school_roles r on r.id = u.role_id
    where u.status = 'active' and u.role not in ('student', 'parent')
  )`;

/**
 * Replace every saved-group rule by the group's own rules (one level: a group inside a group is dropped, so a loop cannot run).
 * A group in include adds its include rules and its excludes; a group in exclude removes what the group includes.
 * Everything that resolves, counts or checks an audience works on the expanded one.
 */
export async function expandGroups(tx: Tx, audience: Audience): Promise<Audience> {
  const wanted = [...new Set(audience.include.concat(audience.exclude).flatMap((r) => (r.type === "group" ? [r.id] : [])))];
  if (!wanted.length) return audience;
  const [t] = await rows<{ ok: boolean }>(tx, sql`select to_regclass('comm_groups') is not null as ok`);
  const groups = new Map<string, Audience>();
  if (t?.ok) for (const g of await rows<{ id: string; audience: Audience }>(tx, sql`select id, audience from comm_groups where id in (${ids(wanted)})`)) groups.set(g.id, g.audience);
  const plain = (rs: AudienceRule[]) => rs.filter((r) => r.type !== "group");
  const include: AudienceRule[] = [], exclude: AudienceRule[] = plain(audience.exclude);
  for (const r of audience.include) {
    if (r.type !== "group") { include.push(r); continue; }
    const g = groups.get(r.id);
    if (g) { include.push(...plain(g.include)); exclude.push(...plain(g.exclude)); }
  }
  for (const r of audience.exclude) if (r.type === "group") exclude.push(...plain(groups.get(r.id)?.include ?? []));
  return { include, exclude };
}

/** The people CTE plus the WHERE for this audience: `with ${head} select ... from people p where ${where}`. */
async function plan(tx: Tx, audience: Audience) {
  const has = await tablesPresent(tx);
  return { head: sql`with ${PEOPLE}`, where: audiencePred(await expandGroups(tx, audience), { has }) };
}

interface Row { student_id: string | null; user_id: string | null; name: string; label: string; section_id: string | null; why: string | null }

/** Everyone the audience reaches, each person once. A student without a working login has userId null. */
export async function resolveAudience(tx: Tx, audience: Audience): Promise<Reached[]> {
  const { head, where } = await plan(tx, audience);
  const found = await rows<Row>(tx, sql`${head} select p.student_id, p.user_id, p.name, p.label, p.section_id from people p where ${where} order by p.name, p.student_id, p.login_user`);
  return found.map((r) => ({ userId: r.user_id, studentId: r.student_id, name: r.name, label: r.label, sectionId: r.section_id }));
}

export interface AudiencePreview { families: number; staff: number; total: number; sample: string[]; unreachable: { name: string; label: string; why: string }[] }

export async function audiencePreview(tx: Tx, audience: Audience): Promise<AudiencePreview> {
  const { head, where } = await plan(tx, audience);
  const [r] = await rows<{ families: number; staff: number; sample: string[]; unreachable: AudiencePreview["unreachable"] }>(tx, sql`${head}, m as (select p.* from people p where ${where})
    select count(*) filter (where is_student)::int as families, count(*) filter (where not is_student)::int as staff,
      (select coalesce(json_agg(n), '[]'::json) from (select name as n from m order by name limit 5) a) as sample,
      (select coalesce(json_agg(json_build_object('name', name, 'label', label, 'why', why)), '[]'::json) from (select name, label, why from m where why is not null order by name limit 100) b) as unreachable
    from m`);
  return { families: r?.families ?? 0, staff: r?.staff ?? 0, total: (r?.families ?? 0) + (r?.staff ?? 0), sample: r?.sample ?? [], unreachable: r?.unreachable ?? [] };
}

/** Is this person (a login, and the students they are the family of) reached by the audience? */
export async function audienceMatches(tx: Tx, audience: Audience, who: { userId: string; studentIds: string[] }): Promise<boolean> {
  const { head, where } = await plan(tx, audience);
  const me = who.studentIds.length ? sql`p.student_id in (${ids(who.studentIds)})` : NO;
  const [r] = await rows<{ ok: boolean }>(tx, sql`${head} select exists (select 1 from people p where (p.user_id = ${who.userId}::uuid or ${me}) and ${where}) as ok`);
  return r?.ok ?? false;
}

// ---- words ----

async function nameOf(tx: Tx, type: string, list: string[]): Promise<Map<string, string>> {
  if (!list.length) return new Map();
  const where = ids(list);
  const q: Record<string, SQL> = {
    class: sql`select c.id::text as id, ${classLabel(sql`c.name`)} as name from classes c where c.id in (${where})`,
    section: sql`select s.id::text as id, ${classLabel(sql`c.name`)} || ' ' || s.name as name from sections s join classes c on c.id = s.class_id where s.id in (${where})`,
    house: sql`select id::text as id, name || ' house' as name from houses where id in (${where})`,
    route: sql`select id::text as id, 'Bus route ' || name as name from routes where id in (${where})`,
    stop: sql`select id::text as id, 'Bus stop ' || name as name from route_stops where id in (${where})`,
    group: sql`select id::text as id, 'Group ' || name as name from comm_groups where id in (${where})`,
    student: sql`select id::text as id, name from students where id in (${where})`,
    person: sql`select id::text as id, name from users where id in (${where})`,
    subject: sql`select id::text as id, name from subjects where id in (${where})`,
  };
  return new Map((await rows<{ id: string; name: string }>(tx, q[type]!)).map((r) => [r.id, r.name]));
}

/** "Class 5 A, Red house, except Bus route 3" for confirmations and the audit log. */
export async function describeAudience(tx: Tx, audience: Audience): Promise<string> {
  const rules = audience.include.concat(audience.exclude);
  const has = await tablesPresent(tx);
  const gather = (type: string, pick: (r: AudienceRule) => string | undefined) => [...new Set(rules.flatMap((r) => { const v = pick(r); return v ? [v] : []; }))];
  const wanted: Record<string, string[]> = {
    class: gather("class", (r) => (r.type === "class" ? r.id : r.type === "teachers_of" ? r.classId : undefined)),
    section: gather("section", (r) => (r.type === "section" ? r.id : r.type === "teachers_of" ? r.sectionId : r.type === "subject" ? r.sectionId : undefined)),
    house: gather("house", (r) => (r.type === "house" ? r.id : undefined)),
    route: gather("route", (r) => (r.type === "route" ? r.id : undefined)),
    stop: gather("stop", (r) => (r.type === "stop" ? r.id : undefined)),
    group: gather("group", (r) => (r.type === "group" ? r.id : undefined)),
    student: gather("student", (r) => (r.type === "student" ? r.id : undefined)),
    person: gather("person", (r) => (r.type === "person" ? r.id : undefined)),
    subject: gather("subject", (r) => (r.type === "subject" ? r.id : undefined)),
  };
  const missingTable: Record<string, boolean> = { house: !has.student_houses, route: !has.routes, stop: !has.route_stops, group: !has.comm_groups };
  const names: Record<string, Map<string, string>> = {};
  for (const [type, list] of Object.entries(wanted)) names[type] = missingTable[type] ? new Map() : await nameOf(tx, type, list);
  const roleIds = rules.flatMap((r) => (r.type === "role" && !(r.id in BUILT_IN_ROLES) ? [r.id] : []));
  const custom = roleIds.length ? new Map((await rows<{ id: string; name: string }>(tx, sql`select id::text, name from school_roles where id::text in (${sql.join(roleIds.map((i) => sql`${i}`), sql`, `)})`)).map((r) => [r.id, r.name])) : new Map<string, string>();
  const n = (type: string, id: string | undefined) => (id ? (names[type]?.get(id) ?? "a removed item") : "");
  const say = (r: AudienceRule): string => {
    switch (r.type) {
      case "everyone": return "Everyone";
      case "families": return "All families";
      case "staff": return "All staff";
      case "role": return (BUILT_IN_ROLES as Record<string, string>)[r.id] ?? custom.get(r.id) ?? "a removed role";
      case "teachers_of": return r.sectionId ? `Teachers of ${n("section", r.sectionId)}` : r.classId ? `Teachers of ${n("class", r.classId)}` : "All teachers";
      case "fee_overdue": return `Families with fees overdue by more than ${r.days} days`;
      case "subject": return `${n("subject", r.id)} students${r.sectionId ? ` of ${n("section", r.sectionId)}` : ""}`;
      default: return n(r.type, r.id);
    }
  };
  const inc = audience.include.map(say).join(", ");
  return audience.exclude.length ? `${inc}, except ${audience.exclude.map(say).join(", ")}` : inc;
}

// ---- picker data ----

/** Fee lists name families who owe money: finance roles only, never a teacher. */
export const canTargetFeeOverdue = (ctx: Pick<Ctx, "role" | "grants">) =>
  ctx.role !== "teacher" && (ctx.grants ? ctx.grants.has("fees:read") || ctx.grants.has("finance:read") : ctx.role === "admin" || ctx.role === "accountant");

/** Sections this teacher teaches or is class teacher of, in the current year. */
export async function teacherSections(tx: Tx, userId: string): Promise<string[]> {
  const has = await tablesPresent(tx);
  const found = await rows<{ id: string }>(tx, sql`with cur as (select id from academic_years where is_current limit 1)
    select s.id::text as id from sections s where s.year_id in (select id from cur) and s.class_teacher_id = ${userId}::uuid
    ${has.section_teachers ? sql`union select t.section_id::text from section_teachers t join sections s on s.id = t.section_id where s.year_id in (select id from cur) and t.teacher_id = ${userId}::uuid` : sql``}`);
  return found.map((r) => r.id);
}

/** The class teacher and the subject teachers of a student's section this year (active people only): the one answer to "who teaches this child". */
export interface StudentTeacher { id: string; name: string; role: string; classTeacher: boolean; subjects: string | null }
export async function teachersOfStudent(tx: Tx, studentId: string): Promise<StudentTeacher[]> {
  return rows<StudentTeacher>(tx, sql`
    select u.id::text as id, u.name, u.role, bool_or(sec.class_teacher_id = u.id) as "classTeacher", string_agg(distinct subj.name, ', ') as subjects
    from students s join sections sec on sec.id = s.section_id and sec.year_id in (select id from academic_years where is_current)
    join users u on u.status = 'active' and (u.id = sec.class_teacher_id or exists (select 1 from section_teachers t where t.section_id = sec.id and t.teacher_id = u.id))
    left join section_teachers st on st.section_id = sec.id and st.teacher_id = u.id
    left join subjects subj on subj.id = st.subject_id
    where s.id = ${studentId}::uuid group by u.id, u.name, u.role order by u.name`);
}

export interface AudienceOptions {
  classes: { id: string; name: string }[];
  sections: { id: string; classId: string; name: string }[];
  houses: { id: string; name: string }[];
  routes: { id: string; name: string }[];
  stops: { id: string; routeId: string; name: string }[];
  subjects: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  groups: { id: string; name: string; shared: boolean; mine: boolean }[];
  /** Sections the caller teaches: the "my sections" chip. */
  mySections: string[];
  /** Sections where the caller is the class teacher: the default audience for a teacher. */
  classTeacherSections: string[];
  canFeeOverdue: boolean;
}

export async function audienceOptions(tx: Tx, ctx: Ctx): Promise<AudienceOptions> {
  const has = await tablesPresent(tx);
  const [classes, sections, houses, subjects, custom, mySections, classTeacherSections] = await Promise.all([
    rows<{ id: string; name: string }>(tx, sql`select id::text, ${classLabel(sql`name`)} as name from classes order by display_order, grade, name`),
    rows<{ id: string; classId: string; name: string }>(tx, sql`select s.id::text, s.class_id::text as "classId", ${classLabel(sql`c.name`)} || ' ' || s.name as name from sections s join classes c on c.id = s.class_id
      where s.year_id in (select id from academic_years where is_current) order by c.display_order, c.grade, s.name`),
    rows<{ id: string; name: string }>(tx, sql`select id::text, name from houses order by name`),
    rows<{ id: string; name: string }>(tx, sql`select id::text, name from subjects order by name`),
    rows<{ id: string; name: string }>(tx, sql`select id::text, name from school_roles order by name`),
    ctx.role === "teacher" ? teacherSections(tx, ctx.userId) : Promise.resolve([] as string[]),
    ctx.role === "teacher" ? rows<{ id: string }>(tx, sql`select s.id::text as id from sections s where s.year_id in (select id from academic_years where is_current) and s.class_teacher_id = ${ctx.userId}::uuid`).then((r) => r.map((x) => x.id)) : Promise.resolve([] as string[]),
  ]);
  const routes = has.routes ? await rows<{ id: string; name: string }>(tx, sql`select id::text, name from routes order by name`) : [];
  const stops = has.route_stops ? await rows<{ id: string; routeId: string; name: string }>(tx, sql`select id::text, route_id::text as "routeId", name from route_stops order by route_id, sequence`) : [];
  const groups = has.comm_groups ? await rows<{ id: string; name: string; shared: boolean; mine: boolean }>(tx, sql`select id::text, name, shared, coalesce(created_by = ${ctx.userId}::uuid, false) as mine from comm_groups where shared or created_by = ${ctx.userId}::uuid order by name`) : [];
  return { classes, sections, houses, routes, stops, subjects, roles: [...Object.entries(BUILT_IN_ROLES).map(([id, name]) => ({ id, name })), ...custom], groups, mySections, classTeacherSections, canFeeOverdue: canTargetFeeOverdue(ctx) };
}

// ---- service for the picker ----

export interface PersonHit { type: "student" | "person"; id: string; label: string; meta: string }
type Perm = keyof typeof notificationsFeature.permissions;

/** Who may look people up: the students:read holders (grants, else the base roles listed by the students feature). */
const canReadStudents = (ctx: Ctx) => (ctx.grants ? ctx.grants.has("students:read") : ctx.role === "admin" || ctx.role === "teacher" || ctx.role === "accountant");
/** Grants that let a person write to an audience, spelled out because notifications imports no other feature. */
const PREVIEW_GRANTS = ["announcements:draft", "events:write", "messages:use", "meetings:manage"] as const;
const canPreview = (ctx: Ctx) => (ctx.grants ? PREVIEW_GRANTS.some((g) => ctx.grants!.has(g)) : ctx.role === "admin" || ctx.role === "teacher" || ctx.role === "accountant");

/** Live count and people search for the picker. Families have the read permission too, so they are refused here. */
export class AudienceService extends SchoolService<Perm> {
  protected feature = notificationsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  private async staffRead<T>(fn: (tx: Tx) => Promise<T>, allowed = canPreview(this.ctx)) {
    if (this.ctx.role === "student" || this.ctx.role === "parent" || !allowed) throw new ForbiddenError();
    return this.read("read", fn);
  }

  options() { return this.staffRead((tx) => audienceOptions(tx, this.ctx)); }

  async preview(input: unknown): Promise<AudiencePreview & { text: string }> {
    const audience = this.parse(audienceField, input);
    return this.staffRead(async (tx) => {
      // A saved group can hide a dues rule, so look at the expanded audience.
      const expanded = await expandGroups(tx, audience);
      if (expanded.include.concat(expanded.exclude).some((r) => r.type === "fee_overdue") && !canTargetFeeOverdue(this.ctx)) throw new ForbiddenError("Only the fees team can pick families with dues.");
      const p = await audiencePreview(tx, audience);
      // Names of people who cannot be reached are student records: only those who may read students see them.
      return { ...p, unreachable: canReadStudents(this.ctx) ? p.unreachable : [], text: await describeAudience(tx, audience) };
    });
  }

  /** Students by name or admission number, staff by name. At least two letters. */
  async people(q: unknown): Promise<PersonHit[]> {
    const allowed = canReadStudents(this.ctx);
    const text = String(q ?? "").trim().slice(0, 60);
    if (text.length < 2) return this.staffRead(async () => [], allowed);
    const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
    return this.staffRead(async (tx) => {
      const kids = await rows<{ id: string; name: string; adm: string; label: string | null }>(tx, sql`select s.id::text, s.name, s.admission_no as adm, ${classLabel(sql`c.name`)} || coalesce(' ' || sec.name, '') as label
        from students s left join classes c on c.id = s.class_id left join sections sec on sec.id = s.section_id
        where s.status = 'active' and (s.name ilike ${like} or s.admission_no ilike ${like}) order by s.name limit 15`);
      const staff = await rows<{ id: string; name: string; label: string }>(tx, sql`select u.id::text, u.name, coalesce(r.name, initcap(u.role)) as label from users u left join school_roles r on r.id = u.role_id
        where u.status = 'active' and u.role not in ('student', 'parent') and u.name ilike ${like} order by u.name limit 10`);
      return [
        ...kids.map((k) => ({ type: "student" as const, id: k.id, label: k.name, meta: [k.label, k.adm].filter(Boolean).join(" · ") })),
        ...staff.map((s) => ({ type: "person" as const, id: s.id, label: s.name, meta: s.label })),
      ];
    }, allowed);
  }
}
