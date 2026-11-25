import { randomInt } from "node:crypto";
import { z } from "zod";
import type { SQL } from "drizzle-orm";
import { Passwords, SchoolAuth } from "@smw/auth";
import { schoolUrl } from "@smw/config";
import {
  SCHOOL_ROLES, and, asc, auditLogs, count, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne, oneTimeTokens, or, schoolRoles, schools, sessions, sql, users,
  type SchoolRole, type Tx,
} from "@smw/db";
import {
  AppError, ConflictError, ForbiddenError, NotFoundError, SchoolService, ValidationError, auditChanges, listQuerySchema, pgErrorCode, refuseSupport, toPage,
  type ListQuery, type Page,
} from "@smw/feature-kit";
import { UploadError, emailHtml, services, uploadKey } from "@smw/integrations";
import { sendAccountMail } from "@smw/feature-notifications/delivery";
import settingsFeature from "./feature";
import { ROLE_TEMPLATES, SYSTEM_ROLES, BASELINE_GRANTS, adminOnlyGrants, allGrants, grantsInWords, matrixFor, permissionLabel, systemGrants, type Catalogue } from "./catalogue";
import { NEW_PROFILE_KEYS, STAFF_ROLES, bulkInput, customRoleInput, loginInput, resetInput, roleInput, schoolProfileInput } from "./inputs";
import { toCsv } from "./people-csv";

type Perm = keyof typeof settingsFeature.permissions;

const IST = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" });
export const istStamp = (d: Date | null) => (d ? IST.format(d) : "");

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---------- files ----------

/** Which stored files the browser may read through `/api/files/<key>`. Keys look like `<schoolId>/<area>/<name>`. */
export class FilePolicy {
  static readonly ROUTE = "/api/files/";

  static url(key: string) { return `${FilePolicy.ROUTE}${key}`; }

  /** The storage key behind one of our file URLs, or null for anything else. */
  static keyOf(url: string | null | undefined) { return url?.startsWith(FilePolicy.ROUTE) ? url.slice(FilePolicy.ROUTE.length) : null; }

  /** `role` is null when nobody is signed in. Public files are open to everyone; `private/` files to nobody (their module checks and signs);
   * exports to nobody (their own route hands them over); a family login gets pictures and document images only, never another area. */
  static canRead(key: string, caller: { schoolId: string; role: SchoolRole | null }): boolean {
    const parts = key.split("/");
    const [school, area] = parts;
    if (school !== caller.schoolId || !area || parts.length < 3 || parts.some((p) => p === "" || p === "..")) return false;
    if (area === "public") return true;
    if (!caller.role) return false;
    if (area === "private") return false;
    // Exports are handed over only by /api/exports/<id>, which checks settings:export, logs the download and knows when the file has expired.
    if (area === "exports") return false;
    if (caller.role === "student" || caller.role === "parent") return area === "avatars" || area === "finance-docs";
    return true;
  }
}

export interface UploadFile { name: string; type: string; size: number; bytes: Uint8Array }

// ---------- shared base ----------

const userCols = {
  id: users.id, name: users.name, email: users.email, phone: users.phone, role: users.role, loginId: users.loginId,
  status: users.status, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
  roleId: users.roleId, roleName: schoolRoles.name, mustChangePassword: users.mustChangePassword, emailVerifiedAt: users.emailVerifiedAt, alertNewDevice: users.alertNewDevice,
};
/** A login as the settings screens see it: never the password hash. `roleName` is set only for custom roles. */
export interface UserRow {
  id: string; name: string; email: string | null; phone: string | null; role: SchoolRole; loginId: string;
  status: "active" | "invited" | "disabled"; lastLoginAt: Date | null; createdAt: Date;
  roleId: string | null; roleName: string | null; mustChangePassword: boolean; emailVerifiedAt: Date | null;
  alertNewDevice: boolean | null;
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
  affiliationNo: schools.affiliationNo, schoolCode: schools.schoolCode, schoolType: schools.schoolType, medium: schools.medium,
  establishedYear: schools.establishedYear, district: schools.district, pincode: schools.pincode, website: schools.website,
  headName: schools.headName, headQualification: schools.headQualification,
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

  /** A Triakshi support session may look at logins but never add, change or sign anyone out. */
  protected noSupport() {
    if (this.ctx.supportStaffId) throw new ForbiddenError("Support sessions cannot manage users.");
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

  /** Old fields: a key left out clears the column (as before). The ten newer fields: a key left out keeps its value, "" clears it. */
  async update(input: unknown): Promise<SchoolProfile> {
    this.authorize("manage", "write");
    const d = this.parse(schoolProfileInput, input);
    const raw = (input ?? {}) as Record<string, unknown>;
    const fresh: Record<string, unknown> = {};
    for (const k of NEW_PROFILE_KEYS) if (raw[k] !== undefined) fresh[k] = d[k] ?? null;
    let before: SchoolProfile | undefined;
    return this.write("manage", async (tx) => {
      [before] = await tx.select(profileCols).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      const [row] = await tx.update(schools).set({
        name: d.name, board: d.board ?? null, state: d.state ?? null, city: d.city ?? null, address: d.address ?? null,
        phone: d.phone ?? null, email: d.email ?? null, gstin: d.gstin ?? null, udiseCode: d.udiseCode ?? null,
        timezone: d.timezone, academicYearStartMonth: d.academicYearStartMonth, ...fresh, updatedAt: new Date(),
      }).where(eq(schools.id, this.ctx.schoolId)).returning(profileCols);
      return row!;
    }, (row) => ({ action: "update", entity: "School", entityId: this.ctx.schoolId, summary: "Updated school details", meta: { changes: auditChanges(before ?? {}, row) } }));
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
      const stale = new Date(Date.now() - 60 * 86_400_000);
      const shows: Record<string, SQL | undefined> = {
        never: isNull(users.lastLoginAt), noemail: isNull(users.email), unverified: and(isNotNull(users.email), isNull(users.emailVerifiedAt)),
        mustchange: eq(users.mustChangePassword, true), custom: isNotNull(users.roleId), stale: and(isNotNull(users.lastLoginAt), lt(users.lastLoginAt, stale)),
      };
      const show = q.filters.show && Object.hasOwn(shows, q.filters.show) ? shows[q.filters.show] : undefined;
      const where = and(
        show,
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
    this.noSupport();
    const { role: pick } = this.parse(roleInput, input);
    if (id === this.ctx.userId) throw new ConflictError("You cannot change your own role.");
    let was = "";
    return this.write("manage", async (tx) => {
      const u = await this.findUser(tx, id);
      was = u.roleName ?? u.role;
      if (!(STAFF_ROLES as readonly string[]).includes(u.role)) throw new ConflictError("Student and parent logins keep their role.");
      const next = await resolveRole(tx, pick, this.ctx.role);
      this.adminOnly(u.role, next.role);
      if (u.role === next.role && u.roleId === next.roleId) return u;
      if (next.role !== "admin") await this.keepAnAdmin(tx, u);
      await tx.update(users).set({ role: next.role, roleId: next.roleId }).where(eq(users.id, id));
      await tx.delete(sessions).where(eq(sessions.userId, id));
      return { ...u, role: next.role, roleId: next.roleId, roleName: next.roleId ? next.label : null };
    }, (r) => ({ action: "change_role", entity: "User", entityId: r.id, summary: `${r.name} is now ${r.roleName ?? r.role}`, meta: { changes: { Role: [was, r.roleName ?? r.role] } } }));
  }

  /** The roles a login can be given, for the pickers and the role filter. */
  async roleOptions(): Promise<{ value: string; label: string }[]> {
    return this.read("manage", async (tx) => [
      ...SYSTEM_ROLES.filter((r) => (STAFF_ROLES as readonly string[]).includes(r.key)).map((r) => ({ value: r.key, label: r.name })),
      ...(await tx.select({ id: schoolRoles.id, name: schoolRoles.name }).from(schoolRoles).orderBy(asc(schoolRoles.name))).map((r) => ({ value: r.id, label: r.name })),
    ]);
  }

  /** Roles a new login can take: admin, accountant, and the school's own office roles. Teachers come from Staff. */
  async loginRoleOptions(): Promise<{ value: string; label: string }[]> {
    return this.read("manage", async (tx) => [
      ...SYSTEM_ROLES.filter((r) => r.key === "admin" || r.key === "accountant").filter((r) => r.key !== "admin" || this.ctx.role === "admin").map((r) => ({ value: r.key, label: r.name })),
      ...(await tx.select({ id: schoolRoles.id, name: schoolRoles.name }).from(schoolRoles).where(eq(schoolRoles.base, "staff")).orderBy(asc(schoolRoles.name))).map((r) => ({ value: r.id, label: r.name })),
    ]);
  }

  /** End every session of this person on every device. */
  async signOutEverywhere(id: string): Promise<{ id: string }> {
    this.noSupport();
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
    this.noSupport();
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
    this.noSupport();
    if (id === this.ctx.userId) throw new ConflictError("You cannot disable your own account.");
    const row = await this.write("manage", async (tx) => {
      const u = await this.findUser(tx, id);
      this.adminOnly(u.role);
      await this.keepAnAdmin(tx, u);
      await tx.update(users).set({ status: "disabled" }).where(eq(users.id, id));
      await tx.delete(oneTimeTokens).where(eq(oneTimeTokens.userId, id));
      return { ...u, status: "disabled" as const };
    }, (r) => ({ action: "disable", entity: "User", entityId: r.id, summary: `Disabled ${r.name}`, meta: { changes: { Account: ["Active", "Disabled"] } } }));
    await this.auth.logoutEverywhere(id);
    return row;
  }

  /** Back to active, or to invited when they never set a password (send a reset link to finish). */
  async enable(id: string): Promise<UserRow> {
    this.noSupport();
    return this.write("manage", async (tx) => {
      const u = await this.findUser(tx, id);
      this.adminOnly(u.role);
      if (u.role === "parent") throw new ConflictError("Parent logins are retired and cannot be enabled.");
      if (await this.isErased(tx, id)) throw new ConflictError("This login was erased at the family's request and cannot be switched back on. Add a new login if the student returns.");
      if (u.status !== "disabled") return u;
      const [h] = await tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, id)).limit(1);
      const status = h?.hash ? "active" as const : "invited" as const;
      await tx.update(users).set({ status }).where(eq(users.id, id));
      return { ...u, status };
    }, (r) => ({ action: "enable", entity: "User", entityId: r.id, summary: `Enabled ${r.name}`, meta: { changes: { Account: ["Disabled", r.status === "invited" ? "Invited" : "Active"] } } }));
  }

  /**
   * `mode: "email"` mails a one-day set-password link (older ones stop working; same /reset-password page invites use).
   * `mode: "temporary"` sets a readable one-time password, shown once; they must change it at next sign-in, and every session ends.
   */
  async resetPassword(id: string, input: unknown = {}): Promise<{ emailed: true } | { temporaryPassword: string; loginId: string }> {
    const { mode } = this.parse(resetInput, input);
    this.noSupport();
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
      await sendAccountMail(this.ctx.schoolId, {
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

  // ----- add a login, bulk actions, CSV, one person's page -----

  /**
   * A new admin, accountant or custom-role login (teachers come from Staff, so their classes are linked). The person starts "invited" and sets their own password:
   * by an emailed 7-day link, or by an access link the admin hands over. A failed mail never undoes the login: the link comes back instead.
   */
  async createLogin(input: unknown): Promise<{ user: UserRow; emailed: boolean; accessLink: string | null }> {
    this.authorize("manage", "write");
    this.noSupport();
    const d = this.parse(loginInput, input);
    let made;
    try {
      made = await this.write("manage", async (tx) => {
        const pick = await resolveRole(tx, d.role, this.ctx.role);
        this.adminOnly(pick.role);
        if (pick.role === "teacher") throw new ValidationError({ role: "Teachers are added from Staff, so their classes and records are linked." });
        const email = d.email?.toLowerCase();
        const clash = await tx.select({ e: users.email, p: users.phone, l: users.loginId }).from(users).where(or(
          email ? sql`lower(${users.email}) = ${email} or lower(${users.loginId}) = ${email}` : undefined, d.phone ? sql`${users.phone} = ${d.phone} or ${users.loginId} = ${d.phone}` : undefined,
        )).limit(1);
        if (clash.length) throw new ValidationError(email && (clash[0]!.e?.toLowerCase() === email || clash[0]!.l.toLowerCase() === email) ? { email: "Someone already signs in with this email" } : { phone: "Someone already signs in with this mobile number" });
        const [u] = await tx.insert(users).values({
          schoolId: this.ctx.schoolId, role: pick.role, roleId: pick.roleId, loginId: email ?? d.phone!, name: d.name, email: email ?? null, phone: d.phone ?? null, status: "invited",
        }).returning({ id: users.id });
        const token = await this.auth.issueToken(tx, "invite", { userId: u!.id, minutes: ACCESS_LINK_MINUTES, meta: email ? { email } : {} });
        return { row: await this.findUser(tx, u!.id), token, school: await this.schoolIdentity(tx) };
      }, (m) => ({ action: "create_login", entity: "User", entityId: m.row.id, summary: `Added a login for ${m.row.name} as ${m.row.roleName ?? m.row.role}` }));
    } catch (err) {
      if (pgErrorCode(err) === "23505") throw new ValidationError({ email: "Someone already signs in with this email or mobile number" });
      throw err;
    }
    const url = schoolUrl(made.school.slug, `/reset-password?token=${made.token}`);
    const emailed = made.row.email && d.send === "email" ? await this.mailInvite(made.row.email, made.row.name, made.school.name, url) : false;
    return { user: made.row, emailed, accessLink: emailed ? null : url };
  }

  /** A fresh 7-day invite for someone who has not set a password yet. Mailed when there is an email; the link comes back when there is none or the mail failed. */
  async resendInvite(id: string): Promise<{ emailed: boolean; accessLink: string | null }> {
    this.noSupport();
    const m = await this.write("manage", async (tx) => {
      const u = await this.findUser(tx, id);
      this.adminOnly(u.role);
      if (u.status !== "invited") throw new ConflictError(u.status === "disabled" ? "This account is disabled. Enable it first." : "They already set a password. Send a password reset instead.");
      await tx.delete(oneTimeTokens).where(and(eq(oneTimeTokens.userId, id), eq(oneTimeTokens.purpose, "invite")));
      const token = await this.auth.issueToken(tx, "invite", { userId: id, minutes: ACCESS_LINK_MINUTES, meta: u.email ? { email: u.email.toLowerCase() } : {} });
      return { u, token, school: await this.schoolIdentity(tx) };
    }, (r) => ({ action: "resend_invite", entity: "User", entityId: id, summary: `Sent a new invite to ${r.u.name}` }));
    const url = schoolUrl(m.school.slug, `/reset-password?token=${m.token}`);
    const emailed = m.u.email ? await this.mailInvite(m.u.email, m.u.name, m.school.name, url) : false;
    return { emailed, accessLink: emailed ? null : url };
  }

  private async mailInvite(to: string, name: string, school: string, url: string): Promise<boolean> {
    try {
      await sendAccountMail(this.ctx.schoolId, {
        to, subject: `Set your password for ${school}`,
        text: `Hello ${name},\n\n${school} has added you to its school dashboard. Set your password here (the link works for 7 days):\n${url}\n`,
        html: emailHtml(`Welcome to ${esc(school)}`, `<p>Hello ${esc(name)}, you have been added to the school dashboard. The link works for 7 days.</p>`, { label: "Set your password", url }),
      });
      return true;
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "login invite email failed", err: String(err) }));
      return false;
    }
  }

  /** One action for up to 100 selected people. Each one is checked on its own: the rest go ahead, and the ones that could not are named with the reason. */
  async bulk(input: unknown): Promise<{ done: number; skipped: { name: string; why: string }[] }> {
    this.authorize("manage", "write");
    this.noSupport();
    const d = this.parse(bulkInput, input);
    const people = new Map((await this.read("manage", (tx) => selectUsers(tx).where(inArray(users.id, d.ids)))).map((u) => [u.id, u]));
    const out = { done: 0, skipped: [] as { name: string; why: string }[] };
    for (const id of d.ids) {
      const u = people.get(id);
      if (!u) continue;
      try {
        if (d.action === "resend") { const r = await this.resendInvite(id); if (!r.emailed) throw new ConflictError(u.email ? "The email could not be sent. Copy an access link from their page." : "No email on file. Copy an access link from their page."); }
        else if (d.action === "disable") await this.disable(id);
        else { if (id === this.ctx.userId) throw new ConflictError("You cannot sign yourself out here."); await this.signOutEverywhere(id); }
        out.done++;
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        out.skipped.push({ name: u.name, why: err.message });
      }
    }
    return out;
  }

  /** The current filter as a CSV (people, role, state, last sign-in): never a password or token. */
  async csv(query: ListQuery = {}): Promise<string> {
    const rows: UserRow[] = [];
    for (let page = 1; rows.length < 20_000; page++) {
      const p = await this.list({ ...query, page, pageSize: 100 });
      rows.push(...p.rows);
      if (page >= p.pageCount) break;
    }
    return toCsv([["Name", "Login ID", "Email", "Mobile", "Role", "Status", "Email verified", "Last sign-in (IST)", "Added (IST)"],
      ...rows.map((u) => [u.name, u.loginId, u.email, u.phone, u.roleName ?? u.role, u.status, u.emailVerifiedAt ? "yes" : "no", istStamp(u.lastLoginAt), istStamp(u.createdAt)])]);
  }

  /** Everything the person's page shows except the sign-in history (that is `SignInService.history`). */
  async detail(id: string, catalogue: Catalogue) {
    return this.read("manage", async (tx) => {
      const user = await this.findUser(tx, id);
      const [role] = user.roleId ? await tx.select({ grants: schoolRoles.grants }).from(schoolRoles).where(eq(schoolRoles.id, user.roleId)) : [];
      const grants = user.role === "admin" ? [...allGrants(catalogue)] : role ? role.grants : systemGrants(user.role, catalogue);
      const [devices, recent, staff, student] = await Promise.all([
        tx.select({ id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, support: sessions.supportStaffId })
          .from(sessions).where(and(eq(sessions.userId, id), gt(sessions.expiresAt, new Date()))).orderBy(desc(sessions.lastSeenAt)),
        // What the person did. Messages and requests are private between the people in them, so they never show here.
        tx.select({ id: auditLogs.id, createdAt: auditLogs.createdAt, module: auditLogs.module, summary: auditLogs.summary }).from(auditLogs)
          .where(and(eq(auditLogs.actorUserId, id), sql`${auditLogs.module} not in ('messages', 'requests')`)).orderBy(desc(auditLogs.createdAt)).limit(15),
        this.recordId(tx, "staff_profiles", id),
        this.recordId(tx, "students", id),
      ]);
      return {
        user, everything: user.role === "admin", access: grantsInWords(grants, catalogue, this.ctx.features), devices, recent,
        record: staff ? { kind: "staff" as const, href: `/app/staff/${id}` } : student ? { kind: "student" as const, href: `/app/students/${student}` } : null,
      };
    });
  }

  /** The id of the record in `table` that belongs to this login, when that module is installed. `table` is a code constant. */
  private async recordId(tx: Tx, table: "staff_profiles" | "students", userId: string): Promise<string | null> {
    const [has] = await tx.execute<{ t: string | null }>(sql`select to_regclass(${table})::text as t`);
    if (!has?.t) return null;
    const [r] = await tx.execute<{ id: string }>(sql`select id::text as id from ${sql.raw(table)} where user_id = ${userId} limit 1`);
    return r?.id ?? null;
  }

  /** End one device of one person. */
  async endSession(userId: string, sessionId: string): Promise<{ id: string }> {
    this.noSupport();
    if (!z.uuid().safeParse(sessionId).success) throw new NotFoundError("Session");
    return this.write("manage", async (tx) => {
      const u = await this.findUser(tx, userId);
      this.adminOnly(u.role);
      const gone = await tx.delete(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId))).returning({ id: sessions.id });
      if (!gone.length) throw new NotFoundError("Session");
      return u;
    }, (u) => ({ action: "end_session", entity: "User", entityId: userId, summary: `Ended one device of ${u.name}` })).then(() => ({ id: sessionId }));
  }

  /** Throws when `u` is the only active admin: a school must always have someone who can manage it. */
  /** An erased login is marked by its login id (set when a student's data was erased); it never comes back. */
  private async isErased(tx: Tx, id: string) {
    const [r] = await tx.select({ loginId: users.loginId }).from(users).where(eq(users.id, id)).limit(1);
    return !!r?.loginId.startsWith("erased-");
  }

  /**
   * Locks every active admin row (always in id order, so two of these cannot deadlock) before counting, so two admins disabling each
   * other at the same moment cannot both pass: the second one sees the first one's result.
   */
  private async keepAnAdmin(tx: Tx, u: UserRow) {
    if (u.role !== "admin" || u.status !== "active") return;
    const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"))).orderBy(users.id).for("update");
    if (!admins.some((a) => a.id === u.id)) return; // somebody already took this one off the list
    if (admins.length < 2) throw new ConflictError("This is the last admin. Make someone else an admin first.");
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
    refuseSupport(this.ctx, "roles");
    const d = this.parse(customRoleInput, input);
    return this.write("manage", async (tx) => {
      await this.checkName(tx, d.name);
      const [r] = await tx.insert(schoolRoles).values({
        schoolId: this.ctx.schoolId, name: d.name, base: d.base, description: d.description ?? null, grants: this.clean(d.grants, catalogue, true),
      }).returning();
      return this.toRow(r!, 0);
    }, (r) => ({ action: "create_role", entity: "Role", entityId: r.key, summary: `Created the role ${r.name}`, meta: { changes: { Name: [null, r.name], "Works like": [null, r.base] } } }));
  }

  /** Grants for modules that are switched off for the school are kept as they were; the form only shows enabled modules. */
  async update(id: string, input: unknown, catalogue: Catalogue): Promise<RoleRow> {
    this.authorize("manage", "write");
    refuseSupport(this.ctx, "roles");
    const d = this.parse(customRoleInput, input);
    const diff = { added: [] as string[], removed: [] as string[] };
    let before: { name: string; base: string; description: string | null } | null = null;
    return this.write("manage", async (tx) => {
      const old = await this.findRole(tx, id);
      before = { name: old.name, base: old.base, description: old.description };
      // Nobody widens the role they hold themselves.
      const [mine] = await tx.select({ roleId: users.roleId }).from(users).where(eq(users.id, this.ctx.userId)).limit(1);
      if (mine?.roleId === id) throw new ForbiddenError("You cannot change the role you hold. Ask an admin.");
      await this.checkName(tx, d.name, id);
      const shown = new Set(matrixFor(catalogue, this.ctx.features).map((m) => m.key));
      const banned = adminOnlyGrants(catalogue);
      const kept = old.grants.filter((g) => !shown.has(featureOf(g)) && !banned.has(g));
      const grants = this.clean([...kept, ...d.grants], catalogue, true);
      diff.added = grants.filter((g) => !old.grants.includes(g));
      diff.removed = old.grants.filter((g) => !grants.includes(g));
      if (diff.removed.length && !d.confirmRemoval) await this.refuseIfUsed(tx, id, diff.removed, catalogue);
      const [r] = await tx.update(schoolRoles).set({
        name: d.name, base: d.base, description: d.description ?? null, grants, updatedAt: new Date(),
      }).where(eq(schoolRoles.id, id)).returning();
      // users.role follows the role's base kind, which drives what data each person sees.
      if (old.base !== d.base) await tx.update(users).set({ role: d.base }).where(eq(users.roleId, id));
      const [n] = await tx.select({ n: count() }).from(users).where(eq(users.roleId, id));
      return this.toRow(r!, Number(n?.n));
    }, (r) => ({ action: "update_role", entity: "Role", entityId: id, summary: `Changed the role ${r.name}`, meta: { added: diff.added, removed: diff.removed, changes: this.roleChanges(before, { name: d.name, base: d.base, description: d.description ?? null }, diff) } }));
  }

  /** What a role edit changed, in words: name, how it works, and the permissions added or taken away. */
  private roleChanges(before: { name: string; base: string; description: string | null } | null, after: { name: string; base: string; description: string | null }, diff: { added: string[]; removed: string[] }) {
    const words = (grants: string[]) => grants.map((g) => g.replace(":", ": ")).join(", ");
    const out: Record<string, [unknown, unknown]> = {};
    if (before?.name !== after.name) out.Name = [before?.name ?? null, after.name];
    if (before?.base !== after.base) out["Works like"] = [before?.base ?? null, after.base];
    if ((before?.description ?? null) !== after.description) out.Description = [before?.description ?? null, after.description];
    if (diff.added.length) out["Permissions added"] = [null, words(diff.added)];
    if (diff.removed.length) out["Permissions removed"] = [words(diff.removed), null];
    return out;
  }

  /**
   * Before a role loses a permission its people used: counts what they wrote in that module over the last 30 days, from the audit log
   * (module and who did it). Viewing is not logged, so view permissions are never counted. Ticking "remove anyway" skips this.
   */
  private async refuseIfUsed(tx: Tx, roleId: string, removed: string[], catalogue: Catalogue) {
    const modules = [...new Set(removed.filter((g) => !/:(read|view)$/.test(g)).map(featureOf))];
    if (!modules.length) return;
    const rows = await tx.select({ module: auditLogs.module, who: users.name, n: count() }).from(auditLogs).innerJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(eq(users.roleId, roleId), inArray(auditLogs.module, modules), gt(auditLogs.createdAt, new Date(Date.now() - 30 * 86_400_000))))
      .groupBy(auditLogs.module, users.name);
    if (!rows.length) return;
    const lines = [...new Set(rows.map((r) => r.module))].map((m) => {
      const mine = rows.filter((r) => r.module === m);
      const names = mine.map((r) => r.who).slice(0, 2).join(" and ") + (mine.length > 2 ? ` and ${mine.length - 2} more` : "");
      const labels = removed.filter((g) => featureOf(g) === m).map((g) => permissionLabel(g.split(":")[1]!, m)).join(", ");
      return `${names} made ${mine.reduce((a, r) => a + Number(r.n), 0)} changes in ${catalogue.find((c) => c.key === m)?.name ?? m} in the last 30 days (removing: ${labels})`;
    });
    const msg = `${lines.join(". ")}. This is counted from the audit log (what people saved, not what they only looked at). Tick "Remove it anyway" to continue.`;
    throw new ValidationError({ confirmRemoval: msg }, msg);
  }

  /** One role's page: who holds it, what changed in it (from the audit log), and what its people did in the last 30 days per module. */
  async detail(id: string, catalogue: Catalogue) {
    const role = (await this.list(catalogue)).find((r) => r.key === id);
    if (!role) throw new NotFoundError("Role");
    return this.read("manage", async (tx) => {
      const system = role.kind === "system";
      const people = await selectUsers(tx).where(system ? and(eq(users.role, role.base), isNull(users.roleId)) : eq(users.roleId, id)).orderBy(asc(users.name)).limit(200);
      const history = system ? [] : await tx.select({ id: auditLogs.id, createdAt: auditLogs.createdAt, action: auditLogs.action, summary: auditLogs.summary, meta: auditLogs.meta, by: users.name })
        .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(and(eq(auditLogs.entity, "Role"), eq(auditLogs.entityId, id))).orderBy(desc(auditLogs.createdAt)).limit(20);
      const ids = people.map((p) => p.id);
      const used = ids.length ? await tx.select({ module: auditLogs.module, n: count() }).from(auditLogs)
        .where(and(inArray(auditLogs.actorUserId, ids), gt(auditLogs.createdAt, new Date(Date.now() - 30 * 86_400_000)))).groupBy(auditLogs.module) : [];
      return { role, people, history, activity: Object.fromEntries(used.map((u) => [u.module, Number(u.n)])) as Record<string, number> };
    });
  }

  async copy(id: string): Promise<RoleRow> {
    refuseSupport(this.ctx, "roles");
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
    refuseSupport(this.ctx, "roles");
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
/** Does this person get a mail when a new device signs in? Their own choice, else the default of their role. */
export const alertsNewDevice = (u: Pick<UserRow, "role" | "alertNewDevice">) => u.alertNewDevice ?? (u.role === "admin" || u.role === "accountant");

export class ProfileService extends SettingsService {
  async setNewDeviceAlert(on: boolean): Promise<void> {
    if (this.ctx.supportStaffId) throw new ForbiddenError("Not available in a support session.");
    await this.write("read", (tx) => tx.update(users).set({ alertNewDevice: on }).where(eq(users.id, this.ctx.userId)),
      () => ({ action: "update", entity: "User", entityId: this.ctx.userId, summary: `Turned new-device emails ${on ? "on" : "off"}` }));
  }

  async me(): Promise<UserRow> {
    return this.read("read", (tx) => this.findUser(tx, this.ctx.userId));
  }
}

export * from "./audit-service";
export * from "./export-service";
export * from "./hub-service";
export * from "./signin-service";
