import { z } from "zod";
import { SchoolAuth } from "@smw/auth";
import { schoolUrl } from "@smw/config";
import {
  and, asc, count, desc, eq, ilike, inArray, oneTimeTokens, or, schools, users, type SchoolRole, type Tx,
} from "@smw/db";
import {
  ConflictError, NotFoundError, SchoolService, ValidationError, listQuerySchema, rethrowUnique, toPage,
  type ListQuery, type Page,
} from "@smw/feature-kit";
import { academicYears, classes, sections, sectionTeachers, subjects } from "@smw/feature-academics/schema";
import { emailHtml, services } from "@smw/integrations";
import staffFeature from "./feature";
import { roleInput, staffInput, staffUpdateInput } from "./inputs";
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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const toRow = ({ u, p }: { u: User; p: Profile }): StaffRow => ({
  id: u.id, profileId: p.id, name: u.name, email: u.email, phone: u.phone, role: u.role, lastLoginAt: u.lastLoginAt,
  state: u.status === "disabled" ? "left" : u.status === "invited" ? "invited" : "active",
  employeeId: p.employeeId, designation: p.designation, department: p.department, qualification: p.qualification,
  joiningDate: p.joiningDate, gender: p.gender, dob: p.dob, address: p.address, photoKey: p.photoKey, subjects: [],
});

/** The profile fields a form can set; absent optional fields clear the column. */
const profileValues = (d: z.infer<typeof staffUpdateInput>) => ({
  employeeId: d.employeeId, email: d.email ?? null, phone: d.phone ?? null, designation: d.designation ?? null,
  department: d.department ?? null, qualification: d.qualification ?? null, joiningDate: d.joiningDate ?? null,
  gender: d.gender ?? null, dob: d.dob ?? null, address: d.address ?? null,
});

interface Invite { to: string; name: string; schoolName: string; token: string; slug: string }

/** Staff: a user row (role admin | accountant | teacher) plus an employment profile, with invites by email. */
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
      const where = and(
        like ? or(ilike(users.name, like), ilike(users.email, like), ilike(staffProfiles.employeeId, like), ilike(staffProfiles.designation, like)) : undefined,
        roleFilter ? eq(users.role, roleFilter) : undefined,
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
    return this.read("read", async (tx) => {
      // Newest first (ids are time-ordered), so the style of the last ID added wins when schools mix prefixes.
      const ids = (await tx.select({ id: staffProfiles.employeeId }).from(staffProfiles).orderBy(desc(staffProfiles.id))).map((r) => r.id);
      const parsed = ids.flatMap((id) => { const m = /^(\D*)(\d+)$/.exec(id); return m ? [{ prefix: m[1]!, n: Number(m[2]), width: m[2]!.length }] : []; });
      if (!parsed.length) return "T001";
      const style = parsed[0]!;
      const last = parsed.filter((p) => p.prefix === style.prefix).reduce((a, b) => (b.n > a.n ? b : a));
      return `${style.prefix}${String(last.n + 1).padStart(last.width, "0")}`;
    });
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
        ...row,
        teaches: teaches.map((t) => ({ sectionId: t.sectionId, section: `${t.className}-${t.section}`, subject: t.subject, year: t.year })),
        classTeacherOf: classTeacherOf.map((t) => ({ sectionId: t.sectionId, section: `${t.className}-${t.section}`, year: t.year })),
      };
    });
  }

  // ---------- writes ----------

  /** Create the login (invited, no password) and the profile, then email the set-password link. Pass `invite: false` for seeds. */
  async create(input: unknown, opts: { invite?: boolean } = {}): Promise<StaffRow & { emailed: boolean }> {
    this.authorize("write", "write"); // permission errors before validation errors
    const d = this.parse(staffInput, input);
    const made = await this.unique({ login: d.email ? "email" : "employeeId" }, () => this.write("write", async (tx) => {
      const [u] = await tx.insert(users).values({
        schoolId: this.ctx.schoolId, role: d.role, loginId: d.email ?? d.employeeId, name: d.name,
        email: d.email ?? null, phone: d.phone ?? null, status: "invited",
      }).returning();
      const [p] = await tx.insert(staffProfiles).values({ ...profileValues(d), schoolId: this.ctx.schoolId, userId: u!.id }).returning();
      const invite = d.email && opts.invite !== false ? await this.invite(tx, u!) : null;
      return { row: toRow({ u: u!, p: p! }), invite };
    }, ({ row }) => ({ action: "create", entity: "Staff", entityId: row.id, summary: `Added ${row.role} ${row.name}` })));
    return { ...made.row, emailed: made.invite ? await this.sendInvite(made.invite) : false };
  }

  /** Edit the person's details (not the role: see changeRole). */
  async update(id: string, input: unknown): Promise<StaffRow> {
    this.authorize("write", "write");
    const d = this.parse(staffUpdateInput, input);
    return this.unique({ login: "email" }, () => this.write("write", async (tx) => {
      const before = await this.findOrThrow(tx, id);
      // The login follows the email when it was the email (create sets it so); an employee-ID or custom login stays.
      const [cur] = await tx.select({ loginId: users.loginId }).from(users).where(eq(users.id, id)).limit(1);
      const followsEmail = !!before.email && cur?.loginId.toLowerCase() === before.email.toLowerCase();
      await tx.update(users).set({ name: d.name, email: d.email ?? null, phone: d.phone ?? null, ...(followsEmail ? { loginId: d.email ?? before.employeeId } : {}) }).where(eq(users.id, id));
      await tx.update(staffProfiles).set(profileValues(d)).where(eq(staffProfiles.userId, id));
      return this.findOrThrow(tx, id);
    }, (row) => ({ action: "update", entity: "Staff", entityId: row.id, summary: `Updated ${row.name}` })));
  }

  async changeRole(id: string, input: unknown): Promise<StaffRow> {
    this.authorize("write", "write");
    const { role } = this.parse(roleInput, input);
    this.notSelf(id, "You cannot change your own role.");
    return this.write("write", async (tx) => {
      const row = await this.findOrThrow(tx, id);
      await tx.update(users).set({ role }).where(eq(users.id, id));
      return { ...row, role };
    }, (row) => ({ action: "change_role", entity: "Staff", entityId: row.id, summary: `${row.name} is now ${row.role}` }));
  }

  /** Mail a fresh set-password link (the old one stops working). Only for people who have not set a password yet. */
  async resendInvite(id: string): Promise<{ emailed: boolean }> {
    const invite = await this.write("write", async (tx) => {
      const row = await this.findOrThrow(tx, id);
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
    return tx.select({ u: users, p: staffProfiles }).from(staffProfiles).innerJoin(users, eq(users.id, staffProfiles.userId));
  }

  private async findOrThrow(tx: Tx, id: string): Promise<StaffRow> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Staff member");
    const [hit] = await this.select(tx).where(eq(users.id, id)).limit(1);
    if (!hit) throw new NotFoundError("Staff member");
    return toRow(hit);
  }

  private notSelf(id: string, message: string) {
    if (id === this.ctx.userId) throw new ConflictError(message);
  }

  /** Replace any older invite with a new 7-day link. Runs inside the caller's transaction. */
  private async invite(tx: Tx, u: User): Promise<Invite> {
    await tx.delete(oneTimeTokens).where(and(eq(oneTimeTokens.userId, u.id), eq(oneTimeTokens.purpose, "invite")));
    const token = await this.auth.issueToken(tx, "invite", { userId: u.id, minutes: INVITE_MINUTES });
    const [school] = await tx.select({ slug: schools.slug, name: schools.name }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
    return { to: u.email!, name: u.name, schoolName: school!.name, slug: school!.slug, token };
  }

  /** Email the link after the transaction committed. A mail failure must not undo the new account; the page offers "Resend invite". */
  private async sendInvite(i: Invite): Promise<boolean> {
    const url = schoolUrl(i.slug, `/reset-password?token=${i.token}`);
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
