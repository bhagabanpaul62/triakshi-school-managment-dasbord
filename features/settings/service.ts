import { randomInt } from "node:crypto";
import { z } from "zod";
import { Passwords, SchoolAuth } from "@smw/auth";
import { schoolUrl } from "@smw/config";
import {
  SCHOOL_ROLES, and, asc, auditLogs, count, desc, eq, ilike, isNull, ne, oneTimeTokens, or, schoolRoles, schools, sessions, sql, users,
  type SchoolRole, type Tx,
} from "@smw/db";
import {
  ConflictError, ForbiddenError, NotFoundError, SchoolService, ValidationError, listQuerySchema, toPage,
  type ListQuery, type Page,
} from "@smw/feature-kit";
import { UploadError, emailHtml, services, uploadKey } from "@smw/integrations";
import settingsFeature from "./feature";
import { ROLE_TEMPLATES, SYSTEM_ROLES, BASELINE_GRANTS, adminOnlyGrants, allGrants, matrixFor, systemGrants, type Catalogue } from "./catalogue";
import { STAFF_ROLES, customRoleInput, exportStudentInput, resetInput, roleInput, schoolProfileInput } from "./inputs";
import { dataExports } from "./schema";

type Perm = keyof typeof settingsFeature.permissions;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---------- files ----------

/** Which stored files the browser may read through `/api/files/<key>`. Keys look like `<schoolId>/<area>/<name>`. */
export class FilePolicy {
  static readonly ROUTE = "/api/files/";

  static url(key: string) { return `${FilePolicy.ROUTE}${key}`; }

  /** The storage key behind one of our file URLs, or null for anything else. */
  static keyOf(url: string | null | undefined) { return url?.startsWith(FilePolicy.ROUTE) ? url.slice(FilePolicy.ROUTE.length) : null; }

  /** `role` is null when nobody is signed in. Public files are open to everyone; data exports to admins only; the rest to any signed-in member of the school. */
  static canRead(key: string, caller: { schoolId: string; role: SchoolRole | null }): boolean {
    const parts = key.split("/");
    const [school, area] = parts;
    if (school !== caller.schoolId || !area || parts.length < 3 || parts.some((p) => p === "" || p === "..")) return false;
    if (area === "public") return true;
    if (!caller.role) return false;
    return area === "exports" ? caller.role === "admin" : true;
  }
}

export interface UploadFile { name: string; type: string; size: number; bytes: Uint8Array }

// ---------- shared base ----------

const userCols = {
  id: users.id, name: users.name, email: users.email, phone: users.phone, role: users.role, loginId: users.loginId,
  status: users.status, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
  roleId: users.roleId, roleName: schoolRoles.name, mustChangePassword: users.mustChangePassword, emailVerifiedAt: users.emailVerifiedAt,
};
/** A login as the settings screens see it: never the password hash. `roleName` is set only for custom roles. */
export interface UserRow {
  id: string; name: string; email: string | null; phone: string | null; role: SchoolRole; loginId: string;
  status: "active" | "invited" | "disabled"; lastLoginAt: Date | null; createdAt: Date;
  roleId: string | null; roleName: string | null; mustChangePassword: boolean; emailVerifiedAt: Date | null;
}
const selectUsers = (tx: Tx) => tx.select(userCols).from(users).leftJoin(schoolRoles, eq(schoolRoles.id, users.roleId));

/** A role pick from a form: a built-in role by key, or a custom role by id. Admins never carry a role id. */
export async function resolveRole(tx: Tx, value: string, actorRole?: SchoolRole): Promise<{ role: SchoolRole; roleId: string | null; label: string }> {
  const system = SYSTEM_ROLES.find((r) => r.key === value && (STAFF_ROLES as readonly string[]).includes(r.key));
  if (system && system.key === "admin" && actorRole && actorRole !== "admin") throw new ForbiddenError();
  if (system) return { role: system.key, roleId: null, label: system.name };
  if (!z.uuid().safeParse(value).success) throw new ValidationError({ role: "Pick a role" });
  const [r] = await tx.select().from(schoolRoles).where(eq(schoolRoles.id, value)).limit(1);
  if (!r) throw new ValidationError({ role: "That role no longer exists" });
  return { role: r.base, roleId: r.id, label: r.name };
}

const profileCols = {
  slug: schools.slug, name: schools.name, board: schools.board, state: schools.state, city: schools.city, address: schools.address,
  phone: schools.phone, email: schools.email, gstin: schools.gstin, udiseCode: schools.udiseCode, timezone: schools.timezone,
  academicYearStartMonth: schools.academicYearStartMonth, logoUrl: schools.logoUrl,
};
export type SchoolProfile = Pick<typeof schools.$inferSelect, keyof typeof profileCols>;

/** Everything the settings services share: the feature, the school's auth, and user lookup. */
abstract class SettingsService extends SchoolService<Perm> {
  protected readonly feature = settingsFeature;

  protected get auth() { return new SchoolAuth(this.ctx.schoolId); }

  protected async findUser(tx: Tx, id: string): Promise<UserRow> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("User");
    const [u] = await selectUsers(tx).where(eq(users.id, id)).limit(1);
    if (!u) throw new NotFoundError("User");
    return u;
  }

  /** Only an admin may act on an admin, or make someone one. */
  protected adminOnly(...roles: SchoolRole[]) {
    if (roles.includes("admin") && this.ctx.role !== "admin") throw new ForbiddenError();
  }

  protected async schoolIdentity(tx: Tx) {
    const [s] = await tx.select({ slug: schools.slug, name: schools.name }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
    return s!;
  }
}

// ---------- school profile ----------

/** The school's own row: details, logo. The school app may only update the columns the database grants. */
export class SchoolProfileService extends SettingsService {
  async get(): Promise<SchoolProfile> {
    return this.read("manage", async (tx) => {
      const [row] = await tx.select(profileCols).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      if (!row) throw new NotFoundError("School");
      return row;
    });
  }

  async update(input: unknown): Promise<SchoolProfile> {
    this.authorize("manage", "write");
    const d = this.parse(schoolProfileInput, input);
    return this.write("manage", async (tx) => {
      const [row] = await tx.update(schools).set({
        name: d.name, board: d.board ?? null, state: d.state ?? null, city: d.city ?? null, address: d.address ?? null,
        phone: d.phone ?? null, email: d.email ?? null, gstin: d.gstin ?? null, udiseCode: d.udiseCode ?? null,
        timezone: d.timezone, academicYearStartMonth: d.academicYearStartMonth, updatedAt: new Date(),
      }).where(eq(schools.id, this.ctx.schoolId)).returning(profileCols);
      return row!;
    }, () => ({ action: "update", entity: "School", entityId: this.ctx.schoolId, summary: "Updated school details" }));
  }

  /**
   * Store a new logo under `<school>/public/logo/` and point `logo_url` at the file route. The old logo file is removed.
   * shortcut: the image type is the one the browser declared (size is measured); sniff the bytes if logos ever come from untrusted uploaders.
   */
  async setLogo(file: UploadFile): Promise<{ logoUrl: string }> {
    this.authorize("manage", "write");
    let key: string;
    try {
      key = uploadKey(this.ctx.schoolId, "public/logo", { ...file, size: file.bytes.byteLength }, "image");
    } catch (err) {
      if (err instanceof UploadError) throw new ValidationError({ logo: err.message }, err.message);
      throw err;
    }
    const done = await this.write("manage", async (tx) => {
      const [prev] = await tx.select({ logoUrl: schools.logoUrl }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      await services().storage.put(key, file.bytes, file.type);
      const logoUrl = FilePolicy.url(key);
      await tx.update(schools).set({ logoUrl, updatedAt: new Date() }).where(eq(schools.id, this.ctx.schoolId));
      return { logoUrl, previous: FilePolicy.keyOf(prev?.logoUrl) };
    }, () => ({ action: "update_logo", entity: "School", entityId: this.ctx.schoolId, summary: "Changed the school logo" }));
    // Only ever delete a previous logo, never another kind of file the URL might point at.
    if (done.previous?.startsWith(`${this.ctx.schoolId}/public/logo/`)) await services().storage.delete(done.previous).catch(() => undefined);
    return { logoUrl: done.logoUrl };
  }
}

// ---------- users and roles ----------

const RESET_MINUTES = 24 * 60;
const ACCESS_LINK_MINUTES = 7 * 24 * 60;
/** No 0/o, 1/l/i: a password read out over the phone or copied from a slip. */
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const STATUSES = ["active", "invited", "disabled"] as const;

/** Every login in the school: change role, disable and enable, send a password reset link. */
export class UserAdminService extends SettingsService {
  async list(query: ListQuery = {}): Promise<Page<UserRow>> {
    const q = listQuerySchema.parse(query);
    return this.read("manage", async (tx) => {
      const like = q.q ? `%${q.q}%` : null;
      const roleFilter = q.filters.role;
      const custom = z.uuid().safeParse(roleFilter).success ? roleFilter : undefined;
      const role = z.enum(SCHOOL_ROLES).safeParse(roleFilter).data;
      const status = z.enum(STATUSES).safeParse(q.filters.status).data;
      const where = and(
        like ? or(ilike(users.name, like), ilike(users.email, like), ilike(users.loginId, like)) : undefined,
        role ? and(eq(users.role, role), isNull(users.roleId)) : undefined,
        custom ? eq(users.roleId, custom) : undefined,
        status ? eq(users.status, status) : undefined,
      );
      const [rows, totals] = await Promise.all([
        selectUsers(tx).where(where).orderBy(asc(users.name), asc(users.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(users).where(where),
      ]);
      return toPage(rows, Number(totals[0]?.n ?? 0), q);
    });
  }

  /** Head counts for the Users tab: everyone, who is waiting on a first sign-in, who is disabled, and how many admins there are. */
  async summary(): Promise<{ total: number; active: number; invited: number; disabled: number; admins: number }> {
    return this.read("manage", async (tx) => {
      const rows = await tx.select({ status: users.status, role: users.role, n: count() }).from(users).groupBy(users.status, users.role);
      const out = { total: 0, active: 0, invited: 0, disabled: 0, admins: 0 };
      for (const r of rows) {
        const n = Number(r.n);
        out.total += n;
        out[r.status] += n;
        if (r.role === "admin" && r.status === "active") out.admins += n;
      }
      return out;
    });
  }

  /** Staff logins only; the pick is a built-in role or a custom role. An admin can step down only while another active admin remains. The old sessions end. */
  async changeRole(id: string, input: unknown): Promise<UserRow> {
    this.authorize("manage", "write");
    const { role: pick } = this.parse(roleInput, input);
    if (id === this.ctx.userId) throw new ConflictError("You cannot change your own role.");
    return this.write("manage", async (tx) => {
      const u = await this.findUser(tx, id);
      if (!(STAFF_ROLES as readonly string[]).includes(u.role)) throw new ConflictError("Student and parent logins keep their role.");
      const next = await resolveRole(tx, pick, this.ctx.role);
      this.adminOnly(u.role, next.role);
      if (u.role === next.role && u.roleId === next.roleId) return u;
      if (next.role !== "admin") await this.keepAnAdmin(tx, u);
      await tx.update(users).set({ role: next.role, roleId: next.roleId }).where(eq(users.id, id));
      await tx.delete(sessions).where(eq(sessions.userId, id));
      return { ...u, role: next.role, roleId: next.roleId, roleName: next.roleId ? next.label : null };
    }, (r) => ({ action: "change_role", entity: "User", entityId: r.id, summary: `${r.name} is now ${r.roleName ?? r.role}` }));
  }

  /** The roles a login can be given, for the pickers and the role filter. */
  async roleOptions(): Promise<{ value: string; label: string }[]> {
    return this.read("manage", async (tx) => [
      ...SYSTEM_ROLES.filter((r) => (STAFF_ROLES as readonly string[]).includes(r.key)).map((r) => ({ value: r.key, label: r.name })),
      ...(await tx.select({ id: schoolRoles.id, name: schoolRoles.name }).from(schoolRoles).orderBy(asc(schoolRoles.name))).map((r) => ({ value: r.id, label: r.name })),
    ]);
  }

  /** End every session of this person on every device. */
  async signOutEverywhere(id: string): Promise<{ id: string }> {
    await this.write("manage", async (tx) => {
      const u = await this.findUser(tx, id);
      this.adminOnly(u.role);
      await tx.delete(sessions).where(eq(sessions.userId, id));
      return u;
    }, (u) => ({ action: "sign_out_everywhere", entity: "User", entityId: id, summary: `Signed ${u.name} out everywhere` }));
    return { id };
  }

  /** A fresh 7-day link to set a password: an invite while they never signed in, a reset link after. Older links of that kind stop working. */
  async accessLink(id: string): Promise<{ url: string; days: number }> {
    const made = await this.write("manage", async (tx) => {
      const u = await this.findUser(tx, id);
      this.adminOnly(u.role);
      if (u.status === "disabled") throw new ConflictError("This account is disabled. Enable it first.");
      const purpose = u.status === "invited" ? "invite" as const : "reset_password" as const;
      await tx.delete(oneTimeTokens).where(and(eq(oneTimeTokens.userId, id), eq(oneTimeTokens.purpose, purpose)));
      const token = await this.auth.issueToken(tx, purpose, { userId: id, minutes: ACCESS_LINK_MINUTES });
      return { name: u.name, token, school: await this.schoolIdentity(tx) };
    }, (m) => ({ action: "access_link", entity: "User", entityId: id, summary: `Made an access link for ${m.name}` }));
    return { url: schoolUrl(made.school.slug, `/reset-password?token=${made.token}`), days: ACCESS_LINK_MINUTES / 1440 };
  }

  /** Disable the login, cancel unused links and sign them out everywhere. */
  async disable(id: string): Promise<UserRow> {
    this.authorize("manage", "write");
    if (id === this.ctx.userId) throw new ConflictError("You cannot disable your own account.");
    const row = await this.write("manage", async (tx) => {
      const u = await this.findUser(tx, id);
      this.adminOnly(u.role);
      await this.keepAnAdmin(tx, u);
      await tx.update(users).set({ status: "disabled" }).where(eq(users.id, id));
      await tx.delete(oneTimeTokens).where(eq(oneTimeTokens.userId, id));
      return { ...u, status: "disabled" as const };
    }, (r) => ({ action: "disable", entity: "User", entityId: r.id, summary: `Disabled ${r.name}` }));
    await this.auth.logoutEverywhere(id);
    return row;
  }

  /** Back to active, or to invited when they never set a password (send a reset link to finish). */
  async enable(id: string): Promise<UserRow> {
    return this.write("manage", async (tx) => {
      const u = await this.findUser(tx, id);
      this.adminOnly(u.role);
      if (u.role === "parent") throw new ConflictError("Parent logins are retired and cannot be enabled.");
      if (u.status !== "disabled") return u;
      const [h] = await tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, id)).limit(1);
      const status = h?.hash ? "active" as const : "invited" as const;
      await tx.update(users).set({ status }).where(eq(users.id, id));
      return { ...u, status };
    }, (r) => ({ action: "enable", entity: "User", entityId: r.id, summary: `Enabled ${r.name}` }));
  }

  /**
   * `mode: "email"` mails a one-day set-password link (older ones stop working; same /reset-password page invites use).
   * `mode: "temporary"` sets a readable one-time password, shown once; they must change it at next sign-in, and every session ends.
   */
  async resetPassword(id: string, input: unknown = {}): Promise<{ emailed: true } | { temporaryPassword: string; loginId: string }> {
    const { mode } = this.parse(resetInput, input);
    if (mode === "temporary") return this.temporaryPassword(id);
    const mail = await this.write("manage", async (tx) => {
      const u = await this.findUser(tx, id);
      this.adminOnly(u.role);
      if (u.status === "disabled") throw new ConflictError("This account is disabled. Enable it first.");
      if (!u.email) throw new ValidationError({ email: "Add an email address first" }, "There is no email on this account to send the link to.");
      await tx.delete(oneTimeTokens).where(and(eq(oneTimeTokens.userId, id), eq(oneTimeTokens.purpose, "reset_password")));
      const token = await this.auth.issueToken(tx, "reset_password", { userId: id, minutes: RESET_MINUTES });
      return { to: u.email, name: u.name, school: await this.schoolIdentity(tx), token };
    }, (m) => ({ action: "reset_password", entity: "User", entityId: id, summary: `Issued a password reset link for ${m.name}` }));
    const url = schoolUrl(mail.school.slug, `/reset-password?token=${mail.token}`);
    try {
      await services().email.send({
        to: mail.to,
        subject: `Reset your password for ${mail.school.name}`,
        text: `Hello ${mail.name},\n\nYour school admin sent you a link to set a new password. It works for 24 hours:\n${url}\n`,
        html: emailHtml("Reset your password", `<p>Hello ${esc(mail.name)}, use the button to set a new password. The link works for 24 hours.</p>`, { label: "Set a new password", url }),
      });
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "password reset email failed", err: String(err) }));
      throw new ConflictError("The email could not be sent. Check the address and try again.");
    }
    return { emailed: true };
  }

  private async temporaryPassword(id: string) {
    const temporaryPassword = Array.from({ length: 8 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join("").replace(/(.{4})/, "$1-");
    const hash = await Passwords.hash(temporaryPassword);
    const u = await this.write("manage", async (tx) => {
      const u = await this.findUser(tx, id);
      this.adminOnly(u.role);
      if (u.status === "disabled") throw new ConflictError("This account is disabled. Enable it first.");
      await tx.update(users).set({ passwordHash: hash, status: "active", mustChangePassword: true }).where(eq(users.id, id));
      await tx.delete(oneTimeTokens).where(and(eq(oneTimeTokens.userId, id), eq(oneTimeTokens.purpose, "reset_password")));
      await tx.delete(sessions).where(eq(sessions.userId, id));
      return u;
    }, (u) => ({ action: "temporary_password", entity: "User", entityId: id, summary: `Set a temporary password for ${u.name}` }));
    return { temporaryPassword, loginId: u.loginId };
  }

  /** Throws when `u` is the only active admin: a school must always have someone who can manage it. */
  private async keepAnAdmin(tx: Tx, u: UserRow) {
    if (u.role !== "admin" || u.status !== "active") return;
    const [others] = await tx.select({ n: count() }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, u.id)));
    if (!Number(others?.n)) throw new ConflictError("This is the last admin. Make someone else an admin first.");
  }
}

export interface RoleRow {
  /** The built-in role's key, or the custom role's id. */
  key: string; name: string; kind: "system" | "template" | "custom"; base: SchoolRole; description: string | null;
  grants: string[]; users: number;
}

const featureOf = (grant: string) => grant.split(":")[0]!;

/** The school's roles: built-in ones (read-only) and custom ones, including the ready-made templates. */
export class RoleService extends SettingsService {
  /** Built-in roles first, then custom ones by name, each with how many people hold it. Seeds the templates the first time a school has no custom roles. */
  async list(catalogue: Catalogue): Promise<RoleRow[]> {
    await this.ensureTemplates(catalogue);
    return this.read("manage", async (tx) => {
      const [custom, heads] = await Promise.all([
        tx.select().from(schoolRoles).orderBy(asc(schoolRoles.name)),
        tx.select({ role: users.role, roleId: users.roleId, n: count() }).from(users).groupBy(users.role, users.roleId),
      ]);
      const held = (f: (h: (typeof heads)[number]) => boolean) => heads.filter(f).reduce((a, h) => a + Number(h.n), 0);
      return [
        ...SYSTEM_ROLES.map((r): RoleRow => ({
          key: r.key, name: r.name, kind: "system", base: r.key, description: r.description, users: held((h) => h.role === r.key && !h.roleId),
          grants: r.key === "admin" ? [...allGrants(catalogue)] : systemGrants(r.key, catalogue),
        })),
        ...custom.map((r): RoleRow => ({
          key: r.id, name: r.name, kind: r.isTemplate ? "template" : "custom", base: r.base, description: r.description,
          grants: r.grants, users: held((h) => h.roleId === r.id),
        })),
      ];
    });
  }

  /** Add the ready-made roles when the school has no custom roles at all, so a role an admin deleted later stays deleted. */
  async ensureTemplates(catalogue: Catalogue): Promise<void> {
    if (this.ctx.readOnly || !this.can("manage")) return;
    await this.write("manage", async (tx) => {
      const [has] = await tx.select({ n: count() }).from(schoolRoles);
      if (Number(has?.n)) return;
      await tx.insert(schoolRoles).values(ROLE_TEMPLATES.map((t) => ({
        schoolId: this.ctx.schoolId, name: t.name, description: t.description, base: "staff" as const, isTemplate: true,
        grants: this.clean(t.grants, catalogue),
      }))).onConflictDoNothing();
    });
  }

  async create(input: unknown, catalogue: Catalogue): Promise<RoleRow> {
    this.authorize("manage", "write");
    const d = this.parse(customRoleInput, input);
    return this.write("manage", async (tx) => {
      await this.checkName(tx, d.name);
      const [r] = await tx.insert(schoolRoles).values({
        schoolId: this.ctx.schoolId, name: d.name, base: d.base, description: d.description ?? null, grants: this.clean(d.grants, catalogue, true),
      }).returning();
      return this.toRow(r!, 0);
    }, (r) => ({ action: "create_role", entity: "Role", entityId: r.key, summary: `Created the role ${r.name}` }));
  }

  /** Grants for modules that are switched off for the school are kept as they were; the form only shows enabled modules. */
  async update(id: string, input: unknown, catalogue: Catalogue): Promise<RoleRow> {
    this.authorize("manage", "write");
    const d = this.parse(customRoleInput, input);
    return this.write("manage", async (tx) => {
      const old = await this.findRole(tx, id);
      // Nobody widens the role they hold themselves.
      const [mine] = await tx.select({ roleId: users.roleId }).from(users).where(eq(users.id, this.ctx.userId)).limit(1);
      if (mine?.roleId === id) throw new ForbiddenError("You cannot change the role you hold. Ask an admin.");
      await this.checkName(tx, d.name, id);
      const shown = new Set(matrixFor(catalogue, this.ctx.features).map((m) => m.key));
      const banned = adminOnlyGrants(catalogue);
      const kept = old.grants.filter((g) => !shown.has(featureOf(g)) && !banned.has(g));
      const [r] = await tx.update(schoolRoles).set({
        name: d.name, base: d.base, description: d.description ?? null, grants: this.clean([...kept, ...d.grants], catalogue, true), updatedAt: new Date(),
      }).where(eq(schoolRoles.id, id)).returning();
      // users.role follows the role's base kind, which drives what data each person sees.
      if (old.base !== d.base) await tx.update(users).set({ role: d.base }).where(eq(users.roleId, id));
      const [n] = await tx.select({ n: count() }).from(users).where(eq(users.roleId, id));
      return this.toRow(r!, Number(n?.n));
    }, (r) => ({ action: "update_role", entity: "Role", entityId: id, summary: `Changed the role ${r.name}` }));
  }

  async copy(id: string): Promise<RoleRow> {
    return this.write("manage", async (tx) => {
      const old = await this.findRole(tx, id);
      const names = new Set((await tx.select({ n: schoolRoles.name }).from(schoolRoles)).map((r) => r.n.toLowerCase()));
      let name = `Copy of ${old.name}`;
      for (let i = 2; names.has(name.toLowerCase()); i++) name = `Copy of ${old.name} ${i}`;
      const [r] = await tx.insert(schoolRoles).values({ schoolId: this.ctx.schoolId, name, base: old.base, description: old.description, grants: old.grants }).returning();
      return this.toRow(r!, 0);
    }, (r) => ({ action: "copy_role", entity: "Role", entityId: r.key, summary: `Copied a role as ${r.name}` }));
  }

  /** Only while nobody holds the role. */
  async remove(id: string): Promise<{ id: string }> {
    let name = id;
    return this.write("manage", async (tx) => {
      const role = await this.findRole(tx, id);
      name = role.name;
      const [held] = await tx.select({ n: count() }).from(users).where(eq(users.roleId, id));
      if (Number(held?.n)) throw new ConflictError(`${held!.n} ${Number(held!.n) === 1 ? "person has" : "people have"} the ${role.name} role. Move them to another role first.`);
      await tx.delete(schoolRoles).where(eq(schoolRoles.id, id));
      return { id };
    }, () => ({ action: "delete_role", entity: "Role", entityId: id, summary: `Deleted the role ${name}` }));
  }

  /** Real grants only, plus the ones everyone needs. Settings and admin-only grants are refused (strict) or dropped. */
  private clean(grants: string[], catalogue: Catalogue, strict = false): string[] {
    const real = allGrants(catalogue);
    const banned = adminOnlyGrants(catalogue);
    const bad = grants.find((g) => !real.has(g));
    if (bad && strict) throw new ValidationError({ grants: `${bad} is not a permission` });
    const admin = grants.find((g) => banned.has(g));
    if (admin && strict) throw new ValidationError({ grants: `${admin} is for admins only` });
    return [...new Set([...BASELINE_GRANTS, ...grants.filter((g) => !banned.has(g))])].filter((g) => real.has(g)).sort();
  }

  private async findRole(tx: Tx, id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Role");
    const [r] = await tx.select().from(schoolRoles).where(eq(schoolRoles.id, id)).limit(1);
    if (!r) throw new NotFoundError("Role");
    return r;
  }

  private async checkName(tx: Tx, name: string, exceptId?: string) {
    const taken = SYSTEM_ROLES.some((r) => r.name.toLowerCase() === name.toLowerCase())
      || (await tx.select({ id: schoolRoles.id }).from(schoolRoles).where(and(sql`lower(${schoolRoles.name}) = ${name.toLowerCase()}`, exceptId ? ne(schoolRoles.id, exceptId) : undefined))).length > 0;
    if (taken) throw new ValidationError({ name: "A role with this name already exists" });
  }

  private toRow(r: typeof schoolRoles.$inferSelect, held: number): RoleRow {
    return { key: r.id, name: r.name, kind: r.isTemplate ? "template" : "custom", base: r.base, description: r.description, grants: r.grants, users: held };
  }
}

// ---------- my profile ----------

/** The signed-in person's own account, read-only here: edits go through the profile actions and SchoolAuth. */
export class ProfileService extends SettingsService {
  async me(): Promise<UserRow> {
    return this.read("read", (tx) => this.findUser(tx, this.ctx.userId));
  }
}

// ---------- audit log ----------

export interface AuditRow {
  id: string; createdAt: Date; module: string; action: string; entity: string | null; summary: string | null;
  /** Who did it: the person's name, "Name (via support)" for a support session, "System" for jobs. */
  actor: string; ip: string | null;
}

const isDay = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

/** Read-only view of the append-only audit log. Days are IST. */
export class AuditService extends SettingsService {
  async list(query: ListQuery = {}): Promise<Page<AuditRow>> {
    const q = listQuerySchema.parse(query);
    return this.read("audit", async (tx) => {
      const { module, actor, from: f0, to: t0 } = q.filters;
      const from = isDay(f0), to = isDay(t0);
      const actorId = z.uuid().safeParse(actor).data;
      const day = sql`(${auditLogs.createdAt} at time zone 'Asia/Kolkata')::date`;
      const where = and(
        q.q ? ilike(auditLogs.summary, `%${q.q}%`) : undefined,
        module ? eq(auditLogs.module, module) : undefined,
        actorId ? eq(auditLogs.actorUserId, actorId) : undefined,
        from ? sql`${day} >= ${from}::date` : undefined,
        to ? sql`${day} <= ${to}::date` : undefined,
      );
      const [rows, totals] = await Promise.all([
        tx.select({
          id: auditLogs.id, createdAt: auditLogs.createdAt, module: auditLogs.module, action: auditLogs.action, entity: auditLogs.entity,
          summary: auditLogs.summary, ip: auditLogs.ip, name: users.name, staffId: auditLogs.actorStaffId,
        }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(where)
          .orderBy(desc(auditLogs.createdAt), asc(auditLogs.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(auditLogs).where(where),
      ]);
      const out = rows.map(({ name, staffId, ...r }) => ({ ...r, actor: name ? (staffId ? `${name} (via support)` : name) : staffId ? "Support" : "System" }));
      return toPage(out, Number(totals[0]?.n ?? 0), q);
    });
  }

  /** Modules that have written to the log, for the filter. */
  async modules(): Promise<string[]> {
    return this.read("audit", async (tx) => (await tx.selectDistinct({ m: auditLogs.module }).from(auditLogs).orderBy(asc(auditLogs.module))).map((r) => r.m));
  }

  /** People who appear in the log, for the filter. */
  async actors(): Promise<{ id: string; name: string }[]> {
    return this.read("audit", (tx) => tx.selectDistinct({ id: users.id, name: users.name }).from(auditLogs).innerJoin(users, eq(users.id, auditLogs.actorUserId)).orderBy(asc(users.name)));
  }
}

// ---------- data export (DPDP) ----------

/** Salaries are left out unless the admin asks for them. Sealed values (PAN, bank numbers) never leave. */
const isPayroll = (table: string) => table.startsWith("pay_");
/** Never exported: login secrets and session material. */
const SKIP_TABLES = new Set(["sessions", "one_time_tokens", "data_exports"]);
const SKIP_COLUMNS = new Set(["password_hash", "token_hash"]);

export interface ExportResult { id: string; label: string; sizeBytes: number; url: string }

/**
 * One JSON file with the school's data, or one student's, in storage under `<school>/exports/`.
 * Exports go through `read()` on purpose: a read-only or suspended school must still be able to take its data out.
 * shortcut: the whole file is built in memory; stream per table (or zip CSVs) before schools reach tens of thousands of rows per table.
 */
export class ExportService extends SettingsService {
  async exportSchool(opts: { includePayroll?: boolean } = {}): Promise<ExportResult> {
    // Payroll is an admin's own choice; a custom role can never hold settings:export anyway.
    const payroll = !!opts.includePayroll && this.ctx.role === "admin";
    return this.build("school", async (tx) => {
      const [school] = await tx.select(profileCols).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      return { label: payroll ? "All school data, with payroll" : "All school data", data: { school, tables: await this.dump(tx, "school_id", this.ctx.schoolId, payroll) } };
    });
  }

  /** One student: their row plus every table that has a `student_id` column. */
  async exportStudent(input: unknown): Promise<ExportResult> {
    this.authorize("export", "read");
    const { studentId } = this.parse(exportStudentInput, input);
    return this.build("student", async (tx) => {
      const [has] = await tx.execute<{ t: string | null }>(sql`select to_regclass('public.students')::text as t`);
      const [student] = has?.t ? await tx.execute<Record<string, unknown>>(sql`select * from students where id = ${studentId}`) : [];
      if (!student) throw new NotFoundError("Student");
      return { label: `Student: ${student.name ?? studentId}`, data: { student, tables: await this.dump(tx, "student_id", studentId) } };
    });
  }

  /** The latest exports, newest first. */
  async recent(limit = 10) {
    return this.read("export", (tx) => tx.select({
      id: dataExports.id, scope: dataExports.scope, label: dataExports.label, status: dataExports.status, fileKey: dataExports.fileKey,
      sizeBytes: dataExports.sizeBytes, createdAt: dataExports.createdAt, requestedByName: users.name,
    }).from(dataExports).leftJoin(users, eq(users.id, dataExports.requestedBy)).orderBy(desc(dataExports.createdAt)).limit(limit));
  }

  /** Students to pick from for a single-student export. Empty when the school has no students module. */
  async studentOptions(): Promise<{ value: string; label: string }[]> {
    return this.read("export", async (tx) => {
      const [has] = await tx.execute<{ t: string | null }>(sql`select to_regclass('public.students')::text as t`);
      if (!has?.t) return [];
      const rows = await tx.execute<{ id: string; name: string; admission_no: string }>(sql`select id, name, admission_no from students order by name limit 1000`);
      return rows.map((r) => ({ value: r.id, label: `${r.name} (${r.admission_no})` }));
    });
  }

  private async build(scope: "school" | "student", collect: (tx: Tx) => Promise<{ label: string; data: object }>): Promise<ExportResult> {
    if (this.ctx.supportStaffId) throw new ForbiddenError("Data export is not available in a support session.");
    return this.read("export", async (tx) => {
      const { label, data } = await collect(tx);
      const now = new Date();
      const bytes = Buffer.from(JSON.stringify({ exportedAt: now.toISOString(), scope, ...data }, null, 2));
      const key = `${this.ctx.schoolId}/exports/${crypto.randomUUID()}-${scope}-export-${now.toISOString().slice(0, 10)}.json`;
      await services().storage.put(key, bytes, "application/json");
      const [row] = await tx.insert(dataExports).values({
        schoolId: this.ctx.schoolId, scope, label, requestedBy: this.ctx.userId, status: "ready", fileKey: key, sizeBytes: bytes.byteLength, finishedAt: now,
      }).returning();
      await this.audit(tx, { action: "export", entity: "Data export", entityId: row!.id, summary: `Exported ${label}`, meta: { scope, sizeBytes: bytes.byteLength } });
      return { id: row!.id, label, sizeBytes: bytes.byteLength, url: await services().storage.signedUrl(key) };
    });
  }

  /** Every table with `column`, as `{ table: rows[] }` for rows where `column = value`. Table and column names come from the catalog, never from input. */
  private async dump(tx: Tx, column: string, value: string, payroll = false): Promise<Record<string, Record<string, unknown>[]>> {
    const cols = await tx.execute<{ table_name: string; column_name: string }>(sql`
      select c.table_name, c.column_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.table_name in (
        select table_name from information_schema.columns where table_schema = 'public' and column_name = ${column})
      order by c.table_name, c.ordinal_position`);
    const byTable = new Map<string, string[]>();
    for (const c of cols) {
      if (SKIP_TABLES.has(c.table_name) || SKIP_COLUMNS.has(c.column_name) || c.column_name.endsWith("_sealed") || (isPayroll(c.table_name) && !payroll)) continue;
      byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
    }
    const out: Record<string, Record<string, unknown>[]> = {};
    for (const [table, names] of byTable) {
      const list = sql.join(names.map((n) => sql.identifier(n)), sql`, `);
      out[table] = [...await tx.execute(sql`select ${list} from ${sql.identifier(table)} where ${sql.identifier(column)} = ${value} order by 1`)];
    }
    if (!payroll) await this.withoutPay(tx, out);
    return out;
  }

  /**
   * The ledger carries pay too: per-person lines and memos of salary, loan and payout entries, and the requests for them.
   * Without the payroll tick they go; the entries stay (so the books still add up) with their totals and no names.
   */
  private async withoutPay(tx: Tx, out: Record<string, Record<string, unknown>[]>) {
    if (!out.fin_journals && !out.fin_journal_lines && !out.fin_approvals) return;
    const ids = new Set((await tx.execute<{ id: string }>(sql`select id from fin_journals where source_type like 'payroll\_%'`)).map((r) => r.id));
    if (out.fin_journals) out.fin_journals = out.fin_journals.map((j) => (ids.has(j.id as string) ? { ...j, memo: null } : j));
    if (out.fin_journal_lines) {
      out.fin_journal_lines = out.fin_journal_lines.filter((l) => !(ids.has(l.journal_id as string) && l.party_type === "staff"))
        .map((l) => (ids.has(l.journal_id as string) ? { ...l, memo: null } : l));
    }
    if (out.fin_approvals) out.fin_approvals = out.fin_approvals.filter((a) => !String(a.kind).startsWith("payroll."));
  }
}
