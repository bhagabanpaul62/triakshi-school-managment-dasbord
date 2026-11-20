import { z } from "zod";
import { SchoolAuth } from "@smw/auth";
import { schoolUrl } from "@smw/config";
import {
  and, asc, count, desc, eq, ilike, inArray, isNull, ne, oneTimeTokens, or, schoolRoles, schools, sessions, sql, users, withSchool, type SchoolRole, type Tx,
} from "@smw/db";
import {
  ConflictError, FeatureOffError, ForbiddenError, NotFoundError, ReadOnlyError, SchoolService, ValidationError, listQuerySchema, rethrowUnique, toPage,
  type ListQuery, type Page,
} from "@smw/feature-kit";
import { academicYears, classes, sections, sectionTeachers, subjects } from "@smw/feature-academics/schema";
import { SheetError, emailHtml, parseSheet, services, type SheetRows } from "@smw/integrations";
import staffFeature from "./feature";
import { IMPORT_MAX_ROWS, FIELD_COLUMN, bumpId, rowInput, type ImportReport, type ImportRow, type ImportedPerson, type ImportResult } from "./import";
import { myContactInput, roleInput, staffInput, staffUpdateInput } from "./inputs";
import { STAFF_USER_ROLES, staffProfiles } from "./schema";

type Perm = keyof typeof staffFeature.permissions;
type Profile = typeof staffProfiles.$inferSelect;
type User = typeof users.$inferSelect;

export type StaffState = "active" | "invited" | "left";

/** One staff member: the login (users) and the employment record (staff_profiles) as a flat row. `id` is the user id. */
export type StaffRow = {
  id: string;
  profileId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: SchoolRole;
  /** Set when the person holds a custom role; `role` is then that role's base kind. */
  roleId: string | null;
  roleName: string | null;
  /** What the admin cares about: invited (no password yet), active, or left (deactivated). */
  state: StaffState;
  lastLoginAt: Date | null;
  employeeId: string;
  designation: string | null;
  department: string | null;
  qualification: string | null;
  joiningDate: string | null;
  gender: Profile["gender"];
  dob: string | null;
  address: string | null;
  employmentType: Profile["employmentType"];
  experienceYears: number | null;
  bloodGroup: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  photoKey: string | null;
  /** Subjects they teach this year or any year, for the list (empty on other reads). */
  subjects: string[];
};

export interface Teaching { sectionId: string; section: string; subject: string; year: string }
export interface ClassTeacherOf { sectionId: string; section: string; year: string }
export type StaffDetail = StaffRow & { teaches: Teaching[]; classTeacherOf: ClassTeacherOf[] };

const INVITE_MINUTES = 7 * 24 * 60;

/** Postgres unique index name → the form field to blame. */
const UNIQUE_FIELD: Record<string, [field: string, message: string]> = {
  users_school_email: ["email", "Someone at this school already uses this email"],
  users_school_phone: ["phone", "Someone at this school already uses this number"],
  users_school_login: ["login", "Someone at this school already uses this login"],
  staff_profiles_employee: ["employeeId", "This employee ID is already used"],
};

const ROLE_NAMES: Record<string, string> = { admin: "Admin", accountant: "Accountant", teacher: "Teacher", staff: "Staff" };
const createAudit = (row: StaffRow) => ({ action: "create", entity: "Staff", entityId: row.id, summary: `Added ${row.roleName ?? row.role} ${row.name}` });

/** Read an uploaded .xlsx or .csv; an unreadable file is a field error on the form, not a crash. */
async function readSheet(file: { name: string; bytes: Uint8Array }): Promise<SheetRows> {
  try { return await parseSheet(file); }
  catch (e) { if (e instanceof SheetError) throw new ValidationError({ file: e.message }, e.message); throw e; }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const toRow = ({ u, p, r }: { u: User; p: Profile; r?: { name: string | null } | null }): StaffRow => ({
  id: u.id, profileId: p.id, name: u.name, email: u.email, phone: u.phone, role: u.role, roleId: u.roleId, roleName: r?.name ?? null, lastLoginAt: u.lastLoginAt,
  state: u.status === "disabled" ? "left" : u.status === "invited" ? "invited" : "active",
  employeeId: p.employeeId, designation: p.designation, department: p.department, qualification: p.qualification,
  joiningDate: p.joiningDate, gender: p.gender, dob: p.dob, address: p.address, photoKey: p.photoKey, subjects: [],
  employmentType: p.employmentType, experienceYears: p.experienceYears, bloodGroup: p.bloodGroup, emergencyName: p.emergencyName, emergencyPhone: p.emergencyPhone,
});

/** The profile fields a form can set; absent optional fields clear the column. */
const profileValues = (d: z.infer<typeof staffUpdateInput>) => ({
  employeeId: d.employeeId, email: d.email ?? null, phone: d.phone ?? null, designation: d.designation ?? null,
  department: d.department ?? null, qualification: d.qualification ?? null, joiningDate: d.joiningDate ?? null,
  gender: d.gender ?? null, dob: d.dob ?? null, address: d.address ?? null,
  employmentType: d.employmentType ?? null, experienceYears: d.experienceYears ?? null, bloodGroup: d.bloodGroup ?? null,
  emergencyName: d.emergencyName ?? null, emergencyPhone: d.emergencyPhone ?? null,
});

/** The next free employee ID in the school's own style ("T012" then "T013"); newest first, so the style of the last ID added wins when schools mix prefixes. */
async function nextIdIn(tx: Tx): Promise<string> {
  const ids = (await tx.select({ id: staffProfiles.employeeId }).from(staffProfiles).orderBy(desc(staffProfiles.id))).map((r) => r.id);
  const parsed = ids.flatMap((id) => { const m = /^(\D*)(\d+)$/.exec(id); return m ? [{ prefix: m[1]!, n: Number(m[2]), width: m[2]!.length }] : []; });
  if (!parsed.length) return "T001";
  const style = parsed[0]!;
  const last = parsed.filter((p) => p.prefix === style.prefix).reduce((a, b) => (b.n > a.n ? b : a));
  return `${style.prefix}${String(last.n + 1).padStart(last.width, "0")}`;
}

/** What a person teaches: the sections they are class teacher of and their subject slots, newest year first. */
async function teachingOf(tx: Tx, id: string): Promise<{ teaches: Teaching[]; classTeacherOf: ClassTeacherOf[] }> {
  const [teaches, classTeacherOf] = await Promise.all([
    tx.select({ sectionId: sections.id, className: classes.name, section: sections.name, subject: subjects.name, year: academicYears.name })
      .from(sectionTeachers)
      .innerJoin(sections, eq(sections.id, sectionTeachers.sectionId))
      .innerJoin(classes, eq(classes.id, sections.classId))
      .innerJoin(subjects, eq(subjects.id, sectionTeachers.subjectId))
      .innerJoin(academicYears, eq(academicYears.id, sections.yearId))
      .where(eq(sectionTeachers.teacherId, id))
      .orderBy(desc(academicYears.startsOn), asc(classes.grade), asc(sections.name), asc(subjects.name)),
    tx.select({ sectionId: sections.id, className: classes.name, section: sections.name, year: academicYears.name })
      .from(sections)
      .innerJoin(classes, eq(classes.id, sections.classId))
      .innerJoin(academicYears, eq(academicYears.id, sections.yearId))
      .where(eq(sections.classTeacherId, id))
      .orderBy(desc(academicYears.startsOn), asc(classes.grade), asc(sections.name)),
  ]);
  return {
    teaches: teaches.map((t) => ({ sectionId: t.sectionId, section: `${t.className}-${t.section}`, subject: t.subject, year: t.year })),
    classTeacherOf: classTeacherOf.map((t) => ({ sectionId: t.sectionId, section: `${t.className}-${t.section}`, year: t.year })),
  };
}

/** A staff member's own record (what My profile shows). `teaching` is set for teachers only. */
export type MyRecord = Pick<StaffRow, "name" | "email" | "phone" | "role" | "employeeId" | "designation" | "department" | "qualification" | "joiningDate"
  | "employmentType" | "experienceYears" | "bloodGroup" | "address" | "emergencyName" | "emergencyPhone"> & {
  roleName: string | null;
  teaching: { classTeacherOf: ClassTeacherOf[]; teaches: Teaching[]; weeklyPeriods: number | null } | null;
};

/** `to` is null for someone without an email: the admin shares the link by hand. */
interface Invite { to: string | null; name: string; schoolName: string; token: string; slug: string }

/** A role pick from a form: a built-in role by key, or a custom role by id. */
async function resolveRole(tx: Tx, value: string): Promise<{ role: SchoolRole; roleId: string | null }> {
  if (["admin", "accountant", "teacher"].includes(value)) return { role: value as SchoolRole, roleId: null };
  if (!z.uuid().safeParse(value).success) throw new ValidationError({ role: "Pick a role" });
  const [r] = await tx.select().from(schoolRoles).where(eq(schoolRoles.id, value)).limit(1);
  if (!r) throw new ValidationError({ role: "That role no longer exists" });
  return { role: r.base, roleId: r.id };
}

/** Staff: a user row (a built-in or custom role) plus an employment profile, with invites by email. */
export class StaffService extends SchoolService<Perm> {
  protected feature = staffFeature;

  private get auth() { return new SchoolAuth(this.ctx.schoolId); }

  // ---------- reads ----------

  async list(query: ListQuery = {}): Promise<Page<StaffRow>> {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const fl = q.filters;
      const like = q.q ? `%${q.q}%` : null;
      const roleFilter = z.enum(STAFF_USER_ROLES).safeParse(fl.role).data;
      const customFilter = z.uuid().safeParse(fl.role).success ? fl.role : undefined;
      const where = and(
        like ? or(ilike(users.name, like), ilike(users.email, like), ilike(staffProfiles.employeeId, like), ilike(staffProfiles.designation, like)) : undefined,
        roleFilter ? and(eq(users.role, roleFilter), isNull(users.roleId)) : undefined,
        customFilter ? eq(users.roleId, customFilter) : undefined,
        fl.department ? eq(staffProfiles.department, fl.department) : undefined,
        fl.status === "left" ? eq(users.status, "disabled") : undefined,
        fl.status === "invited" ? eq(users.status, "invited") : undefined,
        fl.status === "active" ? eq(users.status, "active") : undefined,
      );
      const sortCols = { name: users.name, joiningDate: staffProfiles.joiningDate, employeeId: staffProfiles.employeeId };
      const sortCol = sortCols[q.sort as keyof typeof sortCols] ?? users.name;
      const dir = q.sort ? q.dir : "asc";
      const [rows, totals] = await Promise.all([
        this.select(tx).where(where).orderBy(dir === "asc" ? asc(sortCol) : desc(sortCol), asc(users.id))
          .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(staffProfiles).innerJoin(users, eq(users.id, staffProfiles.userId)).where(where),
      ]);
      const taught = rows.length
        ? await tx.selectDistinct({ teacherId: sectionTeachers.teacherId, subject: subjects.name }).from(sectionTeachers)
          .innerJoin(subjects, eq(subjects.id, sectionTeachers.subjectId))
          .where(inArray(sectionTeachers.teacherId, rows.map((r) => r.u.id))).orderBy(asc(subjects.name))
        : [];
      return toPage(rows.map((r) => ({ ...toRow(r), subjects: taught.filter((t) => t.teacherId === r.u.id).map((t) => t.subject) })), Number(totals[0]?.n ?? 0), q);
    });
  }

  /** Head counts for the list's number row: everyone, who is waiting on an invite, teachers, and who has left. */
  async counts(): Promise<{ total: number; active: number; invited: number; left: number; teachers: number }> {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ us: users.status, role: users.role, n: count() })
        .from(staffProfiles).innerJoin(users, eq(users.id, staffProfiles.userId)).groupBy(users.status, users.role);
      const out = { total: 0, active: 0, invited: 0, left: 0, teachers: 0 };
      for (const r of rows) {
        const n = Number(r.n);
        const state = r.us === "disabled" ? "left" : r.us === "invited" ? "invited" : "active";
        out[state] += n;
        if (state !== "left") out.total += n;
        if (state !== "left" && r.role === "teacher") out.teachers += n;
      }
      return out;
    });
  }

  /** The next free employee ID in the school's own style ("T012" then "T013"), so the form opens with a sensible default. */
  async nextEmployeeId(): Promise<string> {
    return this.read("read", nextIdIn);
  }

  /** Distinct departments, for the filter. */
  async departments(): Promise<string[]> {
    return this.read("read", async (tx) => {
      const rows = await tx.selectDistinct({ d: staffProfiles.department }).from(staffProfiles).orderBy(asc(staffProfiles.department));
      return rows.map((r) => r.d).filter((d): d is string => !!d);
    });
  }

  /** One staff member with the sections and subjects they teach and the sections they are class teacher of. */
  async get(id: string): Promise<StaffDetail> {
    return this.read("read", async (tx) => {
      const row = await this.findOrThrow(tx, id);
      return { ...row, ...(await teachingOf(tx, id)) };
    });
  }

  /** The caller's own staff record, or null when they have none (a student, a parent). Any staff role may read it, whatever staff:read says. */
  async myRecord(): Promise<MyRecord | null> {
    if (!this.ctx.features.has(this.feature.key)) return null;
    return withSchool(this.ctx.schoolId, async (tx) => {
      const [hit] = await this.select(tx).where(eq(users.id, this.ctx.userId)).limit(1);
      if (!hit) return null;
      const r = toRow(hit);
      let teaching: MyRecord["teaching"] = null;
      if (r.role === "teacher") {
        const t = await teachingOf(tx, r.id);
        // Raw SQL: the timetable module is optional, so staff does not depend on its schema.
        const weeklyPeriods = this.ctx.features.has("timetable")
          ? Number((await tx.execute<{ n: number }>(sql`select count(*)::int as n from timetable_slots ts join tt_versions v on v.id = ts.version_id and v.status = 'live' where ts.teacher_id = ${r.id}`))[0]?.n ?? 0)
          : null;
        teaching = { ...t, weeklyPeriods };
      }
      const { id: _i, profileId: _p, state: _s, lastLoginAt: _l, roleId: _r, gender: _g, dob: _d, photoKey: _k, subjects: _u, ...mine } = r;
      return { ...mine, teaching };
    });
  }

  /** Staff change only these themselves: phone, address, emergency contact, qualification. Applied at once, audit-logged. */
  async updateMyContact(input: unknown): Promise<MyRecord> {
    if (!this.ctx.features.has(this.feature.key)) throw new FeatureOffError(this.feature.key);
    if (this.ctx.readOnly) throw new ReadOnlyError();
    const d = this.parse(myContactInput, input);
    await this.unique({ login: "phone" }, () => withSchool(this.ctx.schoolId, async (tx) => {
      const [before] = await tx.select().from(staffProfiles).where(eq(staffProfiles.userId, this.ctx.userId)).limit(1);
      if (!before) throw new NotFoundError("Staff record");
      const next = { phone: d.phone ?? null, address: d.address ?? null, emergencyName: d.emergencyName ?? null, emergencyPhone: d.emergencyPhone ?? null, qualification: d.qualification ?? null };
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== before[k]);
      if (!changed.length) return;
      await tx.update(staffProfiles).set(next).where(eq(staffProfiles.userId, this.ctx.userId));
      if (changed.includes("phone")) await tx.update(users).set({ phone: next.phone }).where(eq(users.id, this.ctx.userId));
      await this.audit(tx, { action: "update_contact", entity: "Staff", entityId: this.ctx.userId, summary: `Updated own details: ${changed.join(", ")}`, meta: { fields: changed } });
    }));
    return (await this.myRecord())!;
  }

  // ---------- writes ----------

  /**
   * Create the login (invited, no password) and the profile, then email the set-password link.
   * Without an email nothing is sent: `accessLink` is the 7-day link for the admin to share. Pass `invite: false` for seeds.
   */
  async create(input: unknown, opts: { invite?: boolean } = {}): Promise<StaffRow & { emailed: boolean; accessLink: string | null }> {
    this.authorize("write", "write"); // permission errors before validation errors
    const d = this.parse(staffInput, input);
    const made = await this.unique({ login: d.email ? "email" : "employeeId" }, () => this.write("write", (tx) => this.createIn(tx, d, opts.invite !== false), ({ row }) => createAudit(row)));
    return { ...made.row, ...(await this.deliver(made.invite)) };
  }

  /** The create rules inside the caller's transaction (import runs it once per row). The caller audits and, after commit, delivers the invite. */
  private async createIn(tx: Tx, d: z.infer<typeof staffInput>, invite = true): Promise<{ row: StaffRow; invite: Invite | null }> {
    const pick = await resolveRole(tx, d.role);
    this.adminOnly(pick.role);
    const [u] = await tx.insert(users).values({
      schoolId: this.ctx.schoolId, role: pick.role, roleId: pick.roleId, loginId: d.email ?? d.employeeId, name: d.name,
      email: d.email ?? null, phone: d.phone ?? null, status: "invited",
    }).returning();
    const [p] = await tx.insert(staffProfiles).values({ ...profileValues(d), schoolId: this.ctx.schoolId, userId: u!.id }).returning();
    const [r] = pick.roleId ? await tx.select({ name: schoolRoles.name }).from(schoolRoles).where(eq(schoolRoles.id, pick.roleId)) : [];
    return { row: toRow({ u: u!, p: p!, r }), invite: invite ? await this.invite(tx, u!) : null };
  }

  /** After the commit: mail the invite (a failed send never undoes the account), or hand back the link when there is no email. */
  private async deliver(invite: Invite | null): Promise<{ emailed: boolean; accessLink: string | null }> {
    return { emailed: invite ? await this.sendInvite(invite) : false, accessLink: invite && !invite.to ? this.inviteUrl(invite) : null };
  }

  // ---------- import ----------

  /** Dry run: check every row of an .xlsx or .csv and report problems by line and column. Writes nothing. */
  async importCheck(file: { name: string; bytes: Uint8Array }): Promise<ImportReport> {
    const sheet = await readSheet(file);
    return this.read("write", async (tx) => (await this.plan(tx, sheet)).report);
  }

  /** Create everyone in one transaction (all or nothing), then send the invites. Nothing is stored about the links. */
  async importCommit(file: { name: string; bytes: Uint8Array }): Promise<ImportResult> {
    this.authorize("write", "write");
    const sheet = await readSheet(file);
    const made = await this.unique({ login: "file" }, () => this.write("write", async (tx) => {
      const { report, ok } = await this.plan(tx, sheet);
      if (report.failed) throw new ValidationError({ file: `${report.failed} rows have problems. Check the file again.` });
      const out = [];
      for (const r of ok) out.push(await this.createIn(tx, r));
      return out;
    }, (out) => ({ action: "import", entity: "Staff", summary: `Imported ${out.length} staff`, meta: { count: out.length } })));
    const people: ImportedPerson[] = [];
    for (const m of made) {
      people.push({ name: m.row.name, role: m.row.roleName ?? ROLE_NAMES[m.row.role] ?? m.row.role, loginId: m.row.email ?? m.row.employeeId, email: m.row.email, ...(await this.deliver(m.invite)) });
    }
    return { imported: people.length, people };
  }

  /** Validate every row against the school's data. Employee IDs left blank get the next free ID in the school's style. */
  private async plan(tx: Tx, sheet: SheetRows): Promise<{ report: ImportReport; ok: z.infer<typeof staffInput>[] }> {
    const missing = ["name", "role"].filter((c) => !sheet.columns.includes(c));
    if (missing.length) throw new ValidationError({ file: `The file has no "${missing.join('" and "')}" column. Use the template.` });
    if (!sheet.rows.length) throw new ValidationError({ file: "The file has no rows." });
    if (sheet.rows.length > IMPORT_MAX_ROWS) throw new ValidationError({ file: `Import up to ${IMPORT_MAX_ROWS} people at a time.` });

    const roles = new Map<string, { value: string; base: SchoolRole }>(
      (await tx.select().from(schoolRoles)).map((r) => [r.name.toLowerCase(), { value: r.id, base: r.base }]));
    for (const k of ["teacher", "accountant", "admin"] as const) roles.set(k, { value: k, base: k });
    const taken = { login: new Set<string>(), email: new Set<string>(), phone: new Set<string>(), id: new Set<string>() };
    for (const u of await tx.select({ l: users.loginId, e: users.email, p: users.phone }).from(users)) {
      taken.login.add(u.l.toLowerCase()); if (u.e) taken.email.add(u.e.toLowerCase()); if (u.p) taken.phone.add(u.p);
    }
    for (const p of await tx.select({ id: staffProfiles.employeeId }).from(staffProfiles)) taken.id.add(p.id);
    const given = new Set(sheet.rows.map((r) => r.employee_id).filter(Boolean));
    const seen = { email: new Map<string, number>(), phone: new Map<string, number>(), id: new Map<string, number>() };
    let auto: string | null = null;

    const rows: ImportRow[] = [];
    const ok: z.infer<typeof staffInput>[] = [];
    for (const [i, raw] of sheet.rows.entries()) {
      const line = sheet.lines[i]!;
      const { input, errors } = rowInput(raw);
      const bad = new Set(errors.map((e) => e.column));
      const fail = (column: string, message: string) => { if (!bad.has(column)) { bad.add(column); errors.push({ column, message }); } };

      const role = roles.get((raw.role ?? "").toLowerCase());
      if (!role) fail("role", raw.role ? `Unknown role "${raw.role}"` : "Enter a role");
      else if (role.base === "admin" && this.ctx.role !== "admin") fail("role", "Only an admin can add admins");
      let employeeId = raw.employee_id ?? "";
      if (!employeeId) {
        auto = auto ? bumpId(auto) : await nextIdIn(tx);
        while (taken.id.has(auto) || given.has(auto)) auto = bumpId(auto);
        employeeId = auto;
      }
      const parsed = staffInput.safeParse({ ...input, role: role?.value ?? "", employeeId });
      if (!parsed.success) for (const is of parsed.error.issues) { const f = String(is.path[0]); fail(FIELD_COLUMN[f] ?? f, is.message); }

      // Clashes inside the file (the first line keeps the value) and with people already in the school.
      const dup = (col: string, key: string, set: Set<string>, within: Map<string, number>) => {
        if (!key) return;
        const first = within.get(key);
        if (first !== undefined) fail(col, `Same as line ${first}`);
        else { within.set(key, line); if (set.has(key)) fail(col, "Already used at this school"); }
      };
      dup("email", (raw.email ?? "").toLowerCase(), taken.email, seen.email);
      dup("phone", raw.phone ?? "", taken.phone, seen.phone);
      dup("employee_id", employeeId, taken.id, seen.id);
      // With no email the employee ID is the login, and it must not clash with anyone's login (a student's admission number, say).
      if (!raw.email && taken.login.has(employeeId.toLowerCase())) fail("employee_id", "Already used as a login at this school");

      rows.push({ line, name: raw.name ?? "", role: raw.role ?? "", employeeId, errors });
      if (!errors.length && parsed.success) ok.push(parsed.data);
    }
    const failed = rows.filter((r) => r.errors.length).length;
    return { report: { total: rows.length, valid: rows.length - failed, failed, rows }, ok };
  }

  /** Edit the person's details (not the role: see changeRole). */
  async update(id: string, input: unknown): Promise<StaffRow> {
    this.authorize("write", "write");
    const d = this.parse(staffUpdateInput, input);
    return this.unique({ login: "email" }, () => this.write("write", async (tx) => {
      const before = await this.findOrThrow(tx, id);
      this.adminOnly(before.role); // the login follows the email, so editing an admin's email is taking the admin over
      // The login follows the email when it was the email (create sets it so); an employee-ID or custom login stays.
      const [cur] = await tx.select({ loginId: users.loginId }).from(users).where(eq(users.id, id)).limit(1);
      const followsEmail = !!before.email && cur?.loginId.toLowerCase() === before.email.toLowerCase();
      const emailChanged = (d.email ?? null)?.toLowerCase() !== before.email?.toLowerCase();
      await tx.update(users).set({
        name: d.name, email: d.email ?? null, phone: d.phone ?? null,
        ...(emailChanged ? { emailVerifiedAt: null } : {}), ...(followsEmail ? { loginId: d.email ?? before.employeeId } : {}),
      }).where(eq(users.id, id));
      await tx.update(staffProfiles).set(profileValues(d)).where(eq(staffProfiles.userId, id));
      return this.findOrThrow(tx, id);
    }, (row) => ({ action: "update", entity: "Staff", entityId: row.id, summary: `Updated ${row.name}` })));
  }

  /** A built-in or custom role. The last admin cannot step down, and the person's open sessions end. */
  async changeRole(id: string, input: unknown): Promise<StaffRow> {
    this.authorize("write", "write");
    const { role: pick } = this.parse(roleInput, input);
    this.notSelf(id, "You cannot change your own role.");
    return this.write("write", async (tx) => {
      const row = await this.findOrThrow(tx, id);
      const next = await resolveRole(tx, pick);
      if (row.role === next.role && row.roleId === next.roleId) return row;
      this.adminOnly(row.role, next.role);
      if (row.role === "admin" && next.role !== "admin" && row.state === "active") {
        const [others] = await tx.select({ n: count() }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, id)));
        if (!Number(others?.n)) throw new ConflictError("This is the last admin. Make someone else an admin first.");
      }
      await tx.update(users).set({ role: next.role, roleId: next.roleId }).where(eq(users.id, id));
      await tx.delete(sessions).where(eq(sessions.userId, id));
      return this.findOrThrow(tx, id);
    }, (row) => ({ action: "change_role", entity: "Staff", entityId: row.id, summary: `${row.name} is now ${row.roleName ?? row.role}` }));
  }

  /** Roles to pick from when adding or changing staff: built-in ones, then the school's custom roles. */
  async roleOptions(): Promise<{ value: string; label: string }[]> {
    return this.read("read", async (tx) => [
      { value: "teacher", label: "Teacher" }, { value: "accountant", label: "Accountant" }, { value: "admin", label: "Admin" },
      ...(await tx.select({ id: schoolRoles.id, name: schoolRoles.name }).from(schoolRoles).orderBy(asc(schoolRoles.name))).map((r) => ({ value: r.id, label: r.name })),
    ]);
  }

  /** Mail a fresh set-password link (the old one stops working). Only for people who have not set a password yet. */
  async resendInvite(id: string): Promise<{ emailed: boolean }> {
    const invite = await this.write("write", async (tx) => {
      const row = await this.findOrThrow(tx, id);
      this.adminOnly(row.role);
      if (row.state === "left") throw new ConflictError("This person is deactivated. Reactivate them first.");
      if (row.state === "active") throw new ConflictError(`${row.name} has already set a password.`);
      if (!row.email) throw new ValidationError({ email: "Add an email address first" }, "There is no email to send the invite to.");
      const [u] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
      return this.invite(tx, u!);
    }, (i) => ({ action: "resend_invite", entity: "Staff", entityId: id, summary: `Re-sent the invite to ${i.to}` }));
    return { emailed: await this.sendInvite(invite) };
  }

  /** Disable the login, end every session, cancel unused invite links and mark the profile as left. */
  async deactivate(id: string): Promise<StaffRow> {
    this.authorize("write", "write");
    this.notSelf(id, "You cannot deactivate yourself.");
    const row = await this.write("write", async (tx) => {
      const existing = await this.findOrThrow(tx, id);
      this.adminOnly(existing.role);
      if (existing.role === "admin" && existing.state === "active") {
        const [others] = await tx.select({ n: count() }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, id)));
        if (!Number(others?.n)) throw new ConflictError("This is the last admin. Make someone else an admin first.");
      }
      await tx.update(users).set({ status: "disabled" }).where(eq(users.id, id));
      await tx.update(staffProfiles).set({ status: "left" }).where(eq(staffProfiles.userId, id));
      // An unused invite would otherwise let them set a password and become active again.
      await tx.delete(oneTimeTokens).where(eq(oneTimeTokens.userId, id));
      return { ...existing, state: "left" as const };
    }, (r) => ({ action: "deactivate", entity: "Staff", entityId: r.id, summary: `Deactivated ${r.name}` }));
    await this.auth.logoutEverywhere(id);
    return row;
  }

  /** Let a deactivated person back in. Someone who never set a password gets a fresh invite; everyone else signs in as before. */
  async reactivate(id: string): Promise<StaffRow & { emailed: boolean }> {
    this.authorize("write", "write");
    const done = await this.write("write", async (tx) => {
      const before = await this.findOrThrow(tx, id);
      this.adminOnly(before.role);
      if (before.state !== "left") throw new ConflictError(`${before.name} is not deactivated.`);
      const [u] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
      const status = u!.passwordHash ? "active" as const : "invited" as const;
      await tx.update(users).set({ status }).where(eq(users.id, id));
      await tx.update(staffProfiles).set({ status: "active" }).where(eq(staffProfiles.userId, id));
      const invite = status === "invited" && u!.email ? await this.invite(tx, { ...u!, status }) : null;
      return { row: await this.findOrThrow(tx, id), invite };
    }, ({ row }) => ({ action: "reactivate", entity: "Staff", entityId: row.id, summary: `Reactivated ${row.name}` }));
    return { ...done.row, emailed: done.invite ? await this.sendInvite(done.invite) : false };
  }

  // ---------- helpers ----------

  /** The staff query shared by list and get: profile joined to its login. */
  private select(tx: Tx) {
    return tx.select({ u: users, p: staffProfiles, r: { name: schoolRoles.name } }).from(staffProfiles)
      .innerJoin(users, eq(users.id, staffProfiles.userId)).leftJoin(schoolRoles, eq(schoolRoles.id, users.roleId));
  }

  private async findOrThrow(tx: Tx, id: string): Promise<StaffRow> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Staff member");
    const [hit] = await this.select(tx).where(eq(users.id, id)).limit(1);
    if (!hit) throw new NotFoundError("Staff member");
    return toRow(hit);
  }

  /** Only an admin may make someone an admin or change an admin's role. */
  private adminOnly(...roles: SchoolRole[]) {
    if (roles.includes("admin") && this.ctx.role !== "admin") throw new ForbiddenError();
  }

  private notSelf(id: string, message: string) {
    if (id === this.ctx.userId) throw new ConflictError(message);
  }

  /** Replace any older invite with a new 7-day link. Runs inside the caller's transaction. */
  private async invite(tx: Tx, u: User): Promise<Invite> {
    await tx.delete(oneTimeTokens).where(and(eq(oneTimeTokens.userId, u.id), eq(oneTimeTokens.purpose, "invite")));
    const token = await this.auth.issueToken(tx, "invite", { userId: u.id, minutes: INVITE_MINUTES });
    const [school] = await tx.select({ slug: schools.slug, name: schools.name }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
    return { to: u.email, name: u.name, schoolName: school!.name, slug: school!.slug, token };
  }

  private inviteUrl(i: Invite) {
    return schoolUrl(i.slug, `/reset-password?token=${i.token}`);
  }

  /** Email the link after the transaction committed. A mail failure must not undo the new account; the page offers "Resend invite". */
  private async sendInvite(i: Invite): Promise<boolean> {
    if (!i.to) return false;
    const url = this.inviteUrl(i);
    try {
      await services().email.send({
        to: i.to,
        subject: `Set your password for ${i.schoolName}`,
        text: `Hello ${i.name},\n\n${i.schoolName} has added you to its school dashboard. Set your password here (the link works for 7 days):\n${url}\n`,
        html: emailHtml(`Welcome to ${esc(i.schoolName)}`, `<p>Hello ${esc(i.name)}, you have been added to the school dashboard. The link works for 7 days.</p>`, { label: "Set your password", url }),
      });
      return true;
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "staff invite email failed", err: String(err) }));
      return false;
    }
  }

  /** Run a write; a unique-index violation becomes a field error on the form. `login` names the field a login clash belongs to. */
  private async unique<T>(fields: { login: string }, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      const e = err as { constraint_name?: string; cause?: { constraint_name?: string } };
      const hit = UNIQUE_FIELD[e.constraint_name ?? e.cause?.constraint_name ?? ""];
      if (hit) throw new ValidationError({ [hit[0] === "login" ? fields.login : hit[0]]: hit[1] }, hit[1]);
      return rethrowUnique(err, "Another staff member already has these details.");
    }
  }
}
