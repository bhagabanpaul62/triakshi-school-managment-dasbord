/**
 * Identity: password hashing, school sessions, console staff sessions with TOTP, one-time tokens, rate limits.
 * Framework-free; @smw/runtime puts the tokens in cookies.
 * @module @smw/auth
 */
import { argon2, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import * as OTPAuth from "otpauth";
import { accessOf, LOGIN_CLOSED_MESSAGE, startsMessage, studentPhaseOf, type StudentPhase } from "./phase";
import {
  and, auditLogs, desc, eq, gt, inArray, isNull, loginEvents, ne, oneTimeTokens, or, platformStaff, schoolRoles, sessions, sql, staffSessions, users,
  withConsole, withSchool, type SchoolRole, type StaffRole, type Tx,
} from "@smw/db";

export { accessOf, istDay, addDays, leftAccessUntil, longDate, startsMessage, LEFT_ACCESS_DAYS, LOGIN_CLOSED_MESSAGE, mayHear, leftPhases, LEFT_TOPIC, type Access, type StudentPhase } from "./phase";

export const SESSION_DAYS = 30;
export const SUPPORT_SESSION_MINUTES = 30;
const DAY = 86_400_000;

// ---------- primitives ----------

const argon2Async = promisify(argon2);
const ARGON = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

/** Argon2id via Node's built-in crypto (Node 24.7+), stored as `argon2id$m=..,t=..,p=..$salt$hash`. No native package. */
export class Passwords {
  static async hash(plain: string) {
    const nonce = randomBytes(16);
    const key = await argon2Async("argon2id", { message: plain, nonce, ...ARGON });
    return `argon2id$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${nonce.toString("base64")}$${Buffer.from(key).toString("base64")}`;
  }
  static async verify(hashed: string | null | undefined, plain: string) {
    if (!hashed) return false;
    const [algo, params, salt, digest] = hashed.split("$");
    if (algo !== "argon2id" || !params || !salt || !digest) return false;
    const p = Object.fromEntries(params.split(",").map((kv) => kv.split("=") as [string, string]));
    const expected = Buffer.from(digest, "base64");
    const key = Buffer.from(await argon2Async("argon2id", {
      message: plain, nonce: Buffer.from(salt, "base64"), memory: Number(p.m), passes: Number(p.t), parallelism: Number(p.p), tagLength: expected.length,
    }));
    return key.length === expected.length && timingSafeEqual(key, expected);
  }
}

export class Tokens {
  /** 32 random bytes, URL-safe. Only its hash is stored. */
  static generate() { return randomBytes(32).toString("base64url"); }
  static hash(token: string) { return createHash("sha256").update(token).digest("hex"); }
}

/**
 * Fixed-window rate limiter kept in process memory.
 * shortcut: per-process memory, fine for one app container; move to a Postgres table when the school app runs as several replicas.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private nextSweep = 0;
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  /** Forget keys whose window is over, once a window, so a flood of different keys cannot grow the map for ever. Changes no answer. */
  private sweep(now: number) {
    if (now < this.nextSweep) return;
    this.nextSweep = now + this.windowMs;
    for (const [k, h] of this.hits) if (h.resetAt <= now) this.hits.delete(k);
  }
  /** Keys held right now (for tests). */
  get size() { return this.hits.size; }
  /** True when the call is allowed. */
  take(key: string, now = Date.now()): boolean {
    this.sweep(now);
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) { this.hits.set(key, { count: 1, resetAt: now + this.windowMs }); return true; }
    h.count++;
    return h.count <= this.limit;
  }
  /** True when the key has used up its window, without counting this call. */
  blocked(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    return !!h && h.resetAt > now && h.count >= this.limit;
  }
  reset(key: string) { this.hits.delete(key); }
}

/** 10 login attempts per 15 minutes per account. */
export const loginLimiter = new RateLimiter(10, 15 * 60_000);

/** 50 failed logins per 15 minutes per IP. Only failures count: a whole school signs in from one Wi-Fi address. */
export const loginIpFailLimiter = new RateLimiter(50, 15 * 60_000);

/** Forgot-password: 5 requests per hour per IP and 3 per hour per typed login. */
export const forgotIpLimiter = new RateLimiter(5, 3_600_000);
export const forgotAcctLimiter = new RateLimiter(3, 3_600_000);

/** Code checks: 10 an hour per school and typed login, on top of the per-IP limit. */
export const otpAcctLimiter = new RateLimiter(10, 3_600_000);

/**
 * Rows a failed sign-in may write: 30 per 15 minutes per address and 300 per school, whatever was typed, so a script trying a thousand
 * different names cannot fill the table. Past the cap one summary row is written per window, then nothing.
 */
const ipEventLimiter = new RateLimiter(30, 15 * 60_000);
const schoolEventLimiter = new RateLimiter(300, 15 * 60_000);
const overflowLimiter = new RateLimiter(1, 15 * 60_000);

/** Writes of "rate limited" and bad support-link events: 3 per 15 minutes per school and login, so a flood cannot become a flood of rows. */
const eventLimiter = new RateLimiter(3, 15 * 60_000);

/** "Chrome on Windows": the device family a new-device check compares. */
export function deviceFamily(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `${browser} on ${os}` : browser;
}

/** Verified against when a login is unknown or has no password, so every login costs one Argon2 run. */
let dummyHash: Promise<string> | undefined;
const fakeHash = () => (dummyHash ??= Passwords.hash(randomBytes(16).toString("hex")));

// ---------- email one-time codes ----------

export type OtpUse = "reset" | "login" | "email_change" | "verify_email";
export const OTP_MINUTES = 10;
export const OTP_MAX_TRIES = 5;
const OTP_COOLDOWN_MS = 60_000;
const OTP_PER_HOUR = 5;

/** Why a code was refused. The reason is for tests and logs; the form always shows the same message. */
export class OtpError extends Error {
  constructor(readonly reason: "wrong" | "locked" | "expired" | "none") { super(reason); }
}

/** One message for unknown account, no code, wrong, expired and locked, so nothing tells an attacker which accounts have a live code. */
export function otpMessage(_e: OtpError): string {
  return "That code is not right or has expired. Check the latest email or send a new code.";
}

type OtpCheck = { ok: true; meta: { newEmail?: string } } | { ok: false; err: OtpError };

// ---------- password policy ----------

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyui", "iloveyou",
  "school123", "admin123", "welcome1", "welcome123", "abcd1234", "11111111", "00000000", "demo12345",
]);

/** A message the user can read as-is (policy failures, an email already taken). */
export class AuthInputError extends Error {}
export class PasswordError extends AuthInputError {}

const ddmmyyyy = (d: string | Date) => {
  const iso = (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
  const [y, m, day] = iso.split("-");
  return y && m && day ? `${day}${m}${y}` : "";
};

/** Null when the password is acceptable, otherwise a plain-words reason. `dob` is a date (ISO string or Date). */
export function checkPassword(pw: string, who: { loginId: string; name?: string; dob?: string | Date | null }): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 128) return "Use at most 128 characters.";
  const l = pw.toLowerCase();
  if (l === who.loginId.toLowerCase()) return "Your password cannot be the same as your login ID.";
  if (who.dob && l === ddmmyyyy(who.dob)) return "Your password cannot be your date of birth.";
  if (who.name && l === who.name.toLowerCase().replace(/\s+/g, "")) return "Your password cannot be your name.";
  if (COMMON_PASSWORDS.has(l)) return "That password is too common. Pick one that is harder to guess.";
  return null;
}

// ---------- school users ----------

export interface SessionUser {
  id: string; schoolId: string; role: SchoolRole; name: string; email: string | null; avatarUrl: string | null;
  /** Custom role grants (`feature:permission`); undefined = the feature.ts defaults for `role`. */
  grants?: ReadonlySet<string>;
  roleName: string | null;
  mustChangePassword: boolean;
}
export interface ValidSession {
  sessionId: string; user: SessionUser; readOnly: boolean; supportStaffId: string | null; expiresAt: Date;
  /** The student row's status and last day, for role student with a student row; null for everyone else. */
  phase: StudentPhase | null;
}

export interface SignInMeta { ip?: string; userAgent?: string }

export class LoginError extends Error {
  /** `closed`: the student left and the 90 days are over. `starts`: a joining student before the first day (`joinsOn` says when). Both are said only after the right password or code. */
  constructor(readonly reason: "invalid" | "rate_limited" | "disabled" | "closed" | "starts", readonly joinsOn: string | null = null) { super(reason); }
}

/** The plain sentence for a closed or not-yet-started student login, or null for every other reason. Safe to show: it only exists after a right secret. */
export function loginRefusal(e: LoginError): string | null {
  return e.reason === "closed" ? LOGIN_CLOSED_MESSAGE : e.reason === "starts" ? startsMessage(e.joinsOn) : null;
}

/** Sessions for one school. Every method runs inside that school's RLS scope. */
export class SchoolAuth {
  constructor(private readonly schoolId: string) {}

  /** Log in by email, phone or login ID (admission number for students). Returns the raw session token. Every try, good or bad, is written to login_events. */
  async login(identifier: string, password: string, meta: SignInMeta & { method?: "password" | "api" } = {}) {
    const id = identifier.trim().toLowerCase();
    const method = meta.method ?? "password";
    const ipKey = `ip:${meta.ip ?? "?"}`;
    let known: string | undefined;
    try {
      if (loginIpFailLimiter.blocked(ipKey) || !loginLimiter.take(`acct:${this.schoolId}:${id}`)) throw new LoginError("rate_limited");
      return await withSchool(this.schoolId, async (tx) => {
        const user = await this.findByLogin(tx, identifier);
        known = user?.id;
        const ok = await Passwords.verify(user?.passwordHash || await fakeHash(), password);
        if (!user || !ok || user.role === "parent") { loginIpFailLimiter.take(ipKey); throw new LoginError("invalid"); }
        await this.refuseIfNotOpen(tx, user);
        if (user.status !== "active") throw new LoginError("disabled");
        loginLimiter.reset(`acct:${this.schoolId}:${id}`);
        await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
        const seen = await this.recordSuccess(tx, user.id, identifier, method, meta);
        return { ...(await this.createSession(tx, user.id, { ...meta })), mustChangePassword: user.mustChangePassword, userId: user.id, ...seen };
      });
    } catch (e) {
      if (e instanceof LoginError) await this.logFailure(e.reason, known, identifier, method, meta);
      throw e;
    }
  }

  /** Throws "starts" or "closed" for a student whose first day is ahead or whose 90 days after leaving are over. Call only after the secret is proven. */
  private async refuseIfNotOpen(tx: Tx, user: { id: string; role: string }) {
    if (user.role !== "student") return;
    const a = accessOf(await studentPhaseOf(tx, this.schoolId, user.id));
    if (a.kind === "joining") throw new LoginError("starts", a.joinsOn);
    if (a.kind === "closed") throw new LoginError("closed");
  }

  /** The success row, with whether this device family has signed in as this person before. */
  private async recordSuccess(tx: Tx, userId: string, identifier: string, method: "password" | "code" | "reset" | "api", meta: SignInMeta) {
    const earlier = await tx.select({ ua: loginEvents.userAgent }).from(loginEvents)
      .where(and(eq(loginEvents.userId, userId), eq(loginEvents.outcome, "success"))).orderBy(desc(loginEvents.createdAt)).limit(200);
    const family = deviceFamily(meta.userAgent);
    const newDevice = !earlier.some((r) => deviceFamily(r.ua) === family);
    await tx.insert(loginEvents).values({
      schoolId: this.schoolId, userId, identifier: identifier.trim().toLowerCase().slice(0, 80), outcome: "success", method,
      ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null, newDevice,
    });
    return { newDevice, firstSignIn: earlier.length === 0 };
  }

  /** A failed try in its own transaction (the failing one rolled back). Never throws: a log problem must not change what the person is told. */
  private async logFailure(reason: LoginError["reason"] | "bad_code", userId: string | undefined, identifier: string, method: "password" | "code" | "reset" | "api" | "support", meta: SignInMeta) {
    const key = identifier.trim().toLowerCase();
    if ((reason === "rate_limited" || method === "support") && !eventLimiter.take(`${this.schoolId}:${method}:${key}`)) return;
    const ipKey = `${this.schoolId}:${meta.ip ?? "?"}`;
    // Over the cap: the first overflow of a window leaves one summary row, the rest leave nothing.
    const capped = meta.ip && !ipEventLimiter.take(ipKey) ? ipKey : !schoolEventLimiter.take(this.schoolId) ? this.schoolId : null;
    if (capped && !overflowLimiter.take(capped)) return;
    const outcome = capped ? "rate_limited" as const : method === "support" ? "support_failed" as const : reason === "rate_limited" ? "rate_limited" as const : reason === "disabled" || reason === "closed" || reason === "starts" ? "disabled" as const : reason === "bad_code" && userId ? "bad_code" as const : userId ? "bad_password" as const : "unknown_login" as const;
    try {
      await withSchool(this.schoolId, (tx) => tx.insert(loginEvents).values({
        schoolId: this.schoolId, userId: capped ? null : userId ?? null, identifier: capped ? (capped === this.schoolId ? "many tries on this school" : "many tries from this address") : key.slice(0, 80), outcome, method,
        ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null,
      }));
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "login event not written", err: String(err) }));
    }
  }

  private async findByLogin(tx: Tx, identifier: string) {
    const id = identifier.trim().toLowerCase();
    const [user] = await tx.select().from(users).where(or(
      sql`lower(${users.loginId}) = ${id}`, sql`lower(${users.email}) = ${id}`, eq(users.phone, identifier.trim()),
    )).limit(1);
    return user;
  }

  /** Sign in a user whose identity was just proven by a one-time link or code. */
  async startSession(userId: string, meta: SignInMeta = {}) {
    return withSchool(this.schoolId, async (tx) => {
      const [u] = await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId)).returning({ loginId: users.loginId });
      const seen = await this.recordSuccess(tx, userId, u?.loginId ?? "", "reset", meta);
      return { ...(await this.createSession(tx, userId, meta)), ...seen };
    });
  }

  /** Name, email and login ID for the mails and sign-in that follow a reset. */
  async contactOf(userId: string) {
    return withSchool(this.schoolId, async (tx) => (await tx.select({ name: users.name, email: users.email, loginId: users.loginId }).from(users).where(eq(users.id, userId)).limit(1))[0] ?? null);
  }

  private async audit(tx: Tx, userId: string, action: string, summary: string) {
    await tx.insert(auditLogs).values({ schoolId: this.schoolId, actorUserId: userId, module: "settings", action, entity: "User", entityId: userId, summary });
  }

  /** The student's date of birth as DDMMYYYY, when the students feature is installed and the user is a student. */
  private async dobOf(tx: Tx, userId: string): Promise<string | null> {
    const has = await tx.execute(sql`select to_regclass('students') is not null as ok`);
    if (!has[0]?.ok) return null;
    const rows = await tx.execute(sql`select to_char(dob, 'YYYY-MM-DD') as d from students where user_id = ${userId} limit 1`);
    return (rows[0]?.d as string | undefined) ?? null;
  }

  /** Throws PasswordError when `next` breaks the policy for this user. */
  private async assertPolicy(tx: Tx, u: { id: string; loginId: string; name: string }, next: string) {
    const err = checkPassword(next, { loginId: u.loginId, name: u.name, dob: await this.dobOf(tx, u.id) });
    if (err) throw new PasswordError(err);
  }

  async createSession(tx: Tx, userId: string, opts: { ip?: string; userAgent?: string; supportStaffId?: string; readOnly?: boolean; minutes?: number } = {}) {
    const token = Tokens.generate();
    const expiresAt = new Date(Date.now() + (opts.minutes ? opts.minutes * 60_000 : SESSION_DAYS * DAY));
    await tx.insert(sessions).values({
      schoolId: this.schoolId, userId, tokenHash: Tokens.hash(token), expiresAt,
      ip: opts.ip, userAgent: opts.userAgent?.slice(0, 300), supportStaffId: opts.supportStaffId ?? null, readOnly: opts.readOnly ?? false,
    });
    return { token, expiresAt };
  }

  /** The session for a raw token, or null. Slides the expiry forward once a day (not for support sessions). */
  async validate(token: string | undefined | null): Promise<ValidSession | null> {
    if (!token) return null;
    return withSchool(this.schoolId, async (tx) => {
      const [row] = await tx.select({ s: sessions, u: users, r: schoolRoles }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
        .leftJoin(schoolRoles, eq(schoolRoles.id, users.roleId))
        .where(and(eq(sessions.tokenHash, Tokens.hash(token)), gt(sessions.expiresAt, new Date()))).limit(1);
      if (!row || row.u.status !== "active" || row.u.role === "parent") return null;
      const phase = row.u.role === "student" ? await studentPhaseOf(tx, this.schoolId, row.u.id) : null;
      const access = accessOf(phase);
      if (access.kind === "closed" || access.kind === "joining") return null;
      let expiresAt = row.s.expiresAt;
      if (!row.s.supportStaffId && Date.now() - row.s.lastSeenAt.getTime() > DAY) {
        expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
        await tx.update(sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, row.s.id));
      }
      return {
        sessionId: row.s.id, readOnly: row.s.readOnly, supportStaffId: row.s.supportStaffId, expiresAt, phase,
        user: {
          id: row.u.id, schoolId: row.u.schoolId, role: row.u.role, name: row.u.name, email: row.u.email, avatarUrl: row.u.avatarUrl,
          // Admins always keep the defaults (every grant), so a school can never lock itself out.
          grants: row.r && row.u.role !== "admin" ? new Set(row.r.grants) : undefined,
          roleName: row.r?.name ?? null, mustChangePassword: row.u.mustChangePassword,
        },
      };
    });
  }

  async logout(token: string | undefined | null) {
    if (!token) return;
    await withSchool(this.schoolId, (tx) => tx.delete(sessions).where(eq(sessions.tokenHash, Tokens.hash(token))));
  }

  async logoutEverywhere(userId: string) {
    await withSchool(this.schoolId, (tx) => tx.delete(sessions).where(eq(sessions.userId, userId)));
  }

  /** Needs the current password. With `keepSessionId`, every other session of the user ends. Clears must-change. */
  async changePassword(userId: string, current: string, next: string, keepSessionId?: string) {
    return withSchool(this.schoolId, async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!u || !(await Passwords.verify(u.passwordHash, current))) throw new LoginError("invalid");
      if (next === current) throw new PasswordError("Choose a password different from the current one.");
      await this.assertPolicy(tx, u, next);
      await tx.update(users).set({ passwordHash: await Passwords.hash(next), mustChangePassword: false }).where(eq(users.id, userId));
      if (keepSessionId) await tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
      await this.audit(tx, userId, "change_password", "Changed own password");
    });
  }

  // ----- forgot password -----

  /**
   * Always resolves the same way for known and unknown logins. `send` is set only when a mail should go out;
   * the caller sends it without awaiting so the response time does not tell the two cases apart.
   */
  async requestPasswordReset(identifier: string, ip = "?"): Promise<{ limited: boolean; send?: { to: string; name: string; token: string; code?: string } }> {
    const id = identifier.trim().toLowerCase();
    if (!id) return { limited: false };
    if (!forgotIpLimiter.take(`ip:${ip}`) || !forgotAcctLimiter.take(`${this.schoolId}:${id}`)) return { limited: true };
    return withSchool(this.schoolId, async (tx) => {
      const user = await this.findByLogin(tx, identifier);
      if (!user || user.status !== "active" || user.role === "parent" || !user.email) {
        // shortcut: the same reads and hashing as the known path, not the writes; the mail is sent unawaited, so that is the larger gap.
        await tx.select({ id: oneTimeTokens.id }).from(oneTimeTokens).where(and(eq(oneTimeTokens.userId, user?.id ?? "00000000-0000-0000-0000-000000000000"), eq(oneTimeTokens.purpose, "reset_password"), isNull(oneTimeTokens.usedAt))).limit(2);
        Tokens.hash(Tokens.generate());
        return { limited: false };
      }
      // The new token makes three: cancel every unused one older than the newest two.
      const unused = await tx.select({ id: oneTimeTokens.id }).from(oneTimeTokens).where(and(
        eq(oneTimeTokens.userId, user.id), eq(oneTimeTokens.purpose, "reset_password"), isNull(oneTimeTokens.usedAt), gt(oneTimeTokens.expiresAt, new Date()),
      )).orderBy(desc(oneTimeTokens.createdAt)).offset(2);
      if (unused.length) await tx.delete(oneTimeTokens).where(inArray(oneTimeTokens.id, unused.map((t) => t.id)));
      const token = await this.issueToken(tx, "reset_password", { userId: user.id, minutes: 60 });
      // The same mail carries a code; a throttled code just leaves it out and the link still works.
      const code = (await this.otpThrottled(tx, user.id, "reset")) ? undefined : await this.issueOtp(tx, user.id, "reset");
      return { limited: false, send: { to: user.email, name: user.name, token, code } };
    });
  }

  // ----- email codes (PRD 6.1) -----

  private otpHash(userId: string, code: string) {
    return createHash("sha256").update(`${this.schoolId}:${userId}:${code}`).digest("hex");
  }

  /** True when a code for this user and use went out under 60 s ago, or 5 went out in the last hour. */
  private async otpThrottled(tx: Tx, userId: string, use: OtpUse) {
    const rows = await tx.select({ at: oneTimeTokens.createdAt }).from(oneTimeTokens).where(and(
      eq(oneTimeTokens.userId, userId), eq(oneTimeTokens.purpose, "email_otp"), sql`${oneTimeTokens.meta}->>'use' = ${use}`,
      gt(oneTimeTokens.createdAt, new Date(Date.now() - 3_600_000)),
    ));
    return rows.length >= OTP_PER_HOUR || rows.some((r) => Date.now() - r.at.getTime() < OTP_COOLDOWN_MS);
  }

  /** A new code ends the old one for the same user and use. Returns the plain code: mail it, never store or log it. */
  private async issueOtp(tx: Tx, userId: string, use: OtpUse, extra: { newEmail?: string } = {}) {
    await tx.update(oneTimeTokens).set({ usedAt: new Date() }).where(and(
      eq(oneTimeTokens.userId, userId), eq(oneTimeTokens.purpose, "email_otp"), isNull(oneTimeTokens.usedAt), sql`${oneTimeTokens.meta}->>'use' = ${use}`,
    ));
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await tx.insert(oneTimeTokens).values({
      schoolId: this.schoolId, purpose: "email_otp", tokenHash: Tokens.hash(randomBytes(16).toString("hex")), userId,
      meta: { use, codeHash: this.otpHash(userId, code), attempts: 0, ...extra }, expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000),
    });
    return code;
  }

  /**
   * Check a code inside the caller's transaction. A wrong code is returned, not thrown, so the try count is kept;
   * the caller throws `err` after the transaction ends. A right code is used up here.
   */
  private async checkOtp(tx: Tx, userId: string, use: OtpUse, code: string): Promise<OtpCheck> {
    const [row] = await tx.select().from(oneTimeTokens).where(and(
      eq(oneTimeTokens.userId, userId), eq(oneTimeTokens.purpose, "email_otp"), isNull(oneTimeTokens.usedAt), sql`${oneTimeTokens.meta}->>'use' = ${use}`,
    )).orderBy(desc(oneTimeTokens.createdAt)).limit(1).for("update");
    if (!row) return { ok: false, err: new OtpError("none") };
    if (row.expiresAt.getTime() < Date.now()) return { ok: false, err: new OtpError("expired") };
    const meta = row.meta as { codeHash: string; attempts: number; newEmail?: string };
    if (meta.attempts >= OTP_MAX_TRIES) return { ok: false, err: new OtpError("locked") };
    const a = Buffer.from(this.otpHash(userId, code.replace(/\s/g, "")), "hex");
    const b = Buffer.from(meta.codeHash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      const attempts = meta.attempts + 1;
      const dead = attempts >= OTP_MAX_TRIES;
      await tx.update(oneTimeTokens).set({ meta: { ...meta, attempts }, ...(dead ? { usedAt: new Date() } : {}) }).where(eq(oneTimeTokens.id, row.id));
      return { ok: false, err: new OtpError(dead ? "locked" : "wrong") };
    }
    await tx.update(oneTimeTokens).set({ usedAt: new Date() }).where(eq(oneTimeTokens.id, row.id));
    return { ok: true, meta };
  }

  /**
   * Send a code for "reset" or "login". Same answer for known and unknown logins; a throttled resend is silent too.
   * `send` is set only when a mail should go out (active user with an email); the caller mails it without awaiting.
   */
  async sendOtp(identifier: string, use: "reset" | "login", ip = "?"): Promise<{ limited: boolean; send?: { to: string; name: string; code: string } }> {
    if (!identifier.trim()) return { limited: false };
    if (!forgotIpLimiter.take(`ip:${ip}`)) return { limited: true };
    return withSchool(this.schoolId, async (tx) => {
      const user = await this.findByLogin(tx, identifier);
      if (!user || user.status !== "active" || user.role === "parent" || !user.email || await this.otpThrottled(tx, user.id, use)) return { limited: false };
      return { limited: false, send: { to: user.email, name: user.name, code: await this.issueOtp(tx, user.id, use) } };
    });
  }

  /** Run `fn` for the user a login resolves to, with the code checked first. Wrong codes throw OtpError after the try is saved. */
  private async withOtp<T>(identifier: string, use: OtpUse, code: string, meta: SignInMeta, fn: (tx: Tx, user: typeof users.$inferSelect, meta: { newEmail?: string }) => Promise<T>) {
    const method = use === "login" ? "code" as const : "reset" as const;
    const ip = meta.ip ?? "?";
    if (!loginLimiter.take(`otp-ip:${ip}`) || !otpAcctLimiter.take(`${this.schoolId}:${identifier.trim().toLowerCase()}`)) {
      await this.logFailure("rate_limited", undefined, identifier, method, meta);
      throw new LoginError("rate_limited");
    }
    let found: typeof users.$inferSelect | undefined;
    const out = await withSchool(this.schoolId, async (tx): Promise<{ err: OtpError } | { value: T } | { refused: LoginError }> => {
      const user = await this.findByLogin(tx, identifier);
      found = user;
      // A disabled account is refused before its code is touched.
      if (!user || user.status !== "active" || user.role === "parent") return { err: new OtpError("none") };
      const r = await this.checkOtp(tx, user.id, use, code);
      if (!r.ok) return { err: r.err };
      // Only the right code earns the plain sentence. The code stays used up.
      try { await this.refuseIfNotOpen(tx, user); } catch (e) { if (e instanceof LoginError) return { refused: e }; throw e; }
      return { value: await fn(tx, user, r.meta) };
    });
    if ("refused" in out) {
      await this.logFailure(out.refused.reason, found?.id, identifier, method, meta);
      throw out.refused;
    }
    if ("err" in out) {
      await this.logFailure(found?.status === "disabled" ? "disabled" : "bad_code", found?.id, identifier, method, meta);
      throw out.err;
    }
    return out.value;
  }

  /** Sign in with a code instead of a password. Still reports must-change so the caller can gate. */
  async loginWithCode(identifier: string, code: string, meta: SignInMeta = {}) {
    return this.withOtp(identifier, "login", code, meta, async (tx, user) => {
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      const seen = await this.recordSuccess(tx, user.id, identifier, "code", meta);
      return { ...(await this.createSession(tx, user.id, meta)), mustChangePassword: user.mustChangePassword, userId: user.id, ...seen };
    });
  }

  /** Same result as a reset link: policy applied, sessions ended, must-change cleared. A weak password keeps the code alive. */
  async resetPasswordWithCode(identifier: string, code: string, next: string, ip = "?") {
    return this.withOtp(identifier, "reset", code, { ip }, async (tx, user) => {
      await this.applyReset(tx, user.id, next, "Set a new password with an email code");
      return user.id;
    });
  }

  /** The signed-in user types the code sent to their new address. */
  async confirmEmailChangeWithCode(userId: string, code: string, keepSessionId?: string) {
    if (!otpAcctLimiter.take(`${this.schoolId}:${userId}`)) throw new LoginError("rate_limited");
    const out = await withSchool(this.schoolId, async (tx): Promise<{ err: OtpError } | { value: { userId: string; email: string } }> => {
      const r = await this.checkOtp(tx, userId, "email_change", code);
      if (!r.ok) return { err: r.err };
      if (!r.meta.newEmail) return { err: new OtpError("none") };
      return { value: await this.applyEmailChange(tx, userId, r.meta.newEmail, keepSessionId) };
    });
    if ("err" in out) throw out.err;
    return out.value;
  }

  /** Email a code that proves the signed-in user owns their current email. Throws when there is nothing to verify. */
  async sendVerifyEmailCode(userId: string) {
    return withSchool(this.schoolId, async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!u?.email) throw new AuthInputError("Add an email first.");
      if (u.emailVerifiedAt) throw new AuthInputError("Your email is already verified.");
      if (await this.otpThrottled(tx, userId, "verify_email")) throw new AuthInputError("Wait a minute before asking for another code.");
      return { to: u.email, name: u.name, code: await this.issueOtp(tx, userId, "verify_email") };
    });
  }

  /** Marks the current email verified when the code is right. Wrong codes throw OtpError after the try is saved. */
  async verifyEmailWithCode(userId: string, code: string) {
    if (!otpAcctLimiter.take(`${this.schoolId}:verify:${userId}`)) throw new LoginError("rate_limited");
    const out = await withSchool(this.schoolId, async (tx): Promise<{ err: OtpError } | { ok: true }> => {
      const r = await this.checkOtp(tx, userId, "verify_email", code);
      if (!r.ok) return { err: r.err };
      await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
      await this.audit(tx, userId, "verify_email", "Verified own email");
      return { ok: true };
    });
    if ("err" in out) throw out.err;
  }

  // ----- sessions -----

  async listSessions(userId: string, currentSessionId: string) {
    const rows = await withSchool(this.schoolId, (tx) => tx.select().from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date()))).orderBy(desc(sessions.lastSeenAt)));
    return rows.map((r) => ({ id: r.id, ip: r.ip, userAgent: r.userAgent, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, current: r.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string) {
    await withSchool(this.schoolId, (tx) => tx.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId))));
  }

  async logoutOthers(userId: string, keepSessionId: string) {
    await withSchool(this.schoolId, (tx) => tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))));
  }

  // ----- profile -----

  async updateProfile(userId: string, patch: { name?: string; phone?: string | null; avatarUrl?: string | null }) {
    try {
      await withSchool(this.schoolId, async (tx) => {
        await tx.update(users).set(patch).where(eq(users.id, userId));
        await this.audit(tx, userId, "update_profile", "Updated own profile");
      });
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      if ((e.code ?? e.cause?.code) === "23505") throw new AuthInputError("Another account already uses that mobile number.");
      throw err;
    }
  }

  /**
   * Starts an email change: nothing changes until the link, or the code, sent to the NEW address is used.
   * Needs the current password. `oldEmail` is where the caller mails a "was this you?" notice.
   */
  async requestEmailChange(userId: string, email: string, currentPassword: string) {
    const next = email.trim().toLowerCase();
    if (!loginLimiter.take(`pw:${this.schoolId}:${userId}`)) throw new LoginError("rate_limited");
    return withSchool(this.schoolId, async (tx) => {
      const [me] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!me || !(await Passwords.verify(me.passwordHash, currentPassword))) throw new LoginError("invalid");
      const taken = await tx.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${next}`, ne(users.id, userId))).limit(1);
      if (taken.length) throw new AuthInputError("Another account already uses that email.");
      if (await this.otpThrottled(tx, userId, "email_change")) throw new AuthInputError("Wait a minute before asking for another code.");
      await tx.delete(oneTimeTokens).where(and(eq(oneTimeTokens.userId, userId), eq(oneTimeTokens.purpose, "change_email"), isNull(oneTimeTokens.usedAt)));
      const token = await this.issueToken(tx, "change_email", { userId, minutes: 24 * 60, meta: { email: next } });
      return { token, code: await this.issueOtp(tx, userId, "email_change", { newEmail: next }), oldEmail: me.email };
    });
  }

  /** Ends the user's sessions too (all but `keepSessionId`): whoever started the change may not be the owner. */
  private async applyEmailChange(tx: Tx, userId: string, email: string, keepSessionId?: string) {
    const taken = await tx.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${email}`, ne(users.id, userId))).limit(1);
    if (taken.length) throw new AuthInputError("Another account now uses that email.");
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    // A login that was the old email follows it, as the staff page does.
    const follows = !!u?.email && u.loginId.toLowerCase() === u.email.toLowerCase();
    await tx.update(users).set({ email, emailVerifiedAt: new Date(), ...(follows ? { loginId: email } : {}) }).where(eq(users.id, userId));
    await tx.delete(sessions).where(keepSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)) : eq(sessions.userId, userId));
    await this.audit(tx, userId, "change_email", "Confirmed a new email address");
    return { userId, email };
  }

  async confirmEmailChange(token: string) {
    return withSchool(this.schoolId, async (tx) => {
      const row = await this.consumeToken(tx, "change_email", token);
      const email = (row?.meta as { email?: string } | undefined)?.email;
      if (!row?.userId || !email) throw new LoginError("invalid");
      return this.applyEmailChange(tx, row.userId, email);
    });
  }

  /** Look at a one-time token without using it. */
  async peekToken(purpose: (typeof oneTimeTokens.$inferInsert)["purpose"], token: string) {
    return withSchool(this.schoolId, async (tx) => {
      const [row] = await tx.select().from(oneTimeTokens).where(and(eq(oneTimeTokens.tokenHash, Tokens.hash(token)), eq(oneTimeTokens.purpose, purpose))).limit(1);
      if (!row) return { state: "unknown" as const };
      if (row.usedAt) return { state: "used" as const };
      if (row.expiresAt.getTime() < Date.now()) return { state: "expired" as const };
      return { state: "ok" as const, meta: row.meta };
    });
  }

  // ----- one-time tokens: invite, password reset, email verification, support login -----

  async issueToken(tx: Tx, purpose: (typeof oneTimeTokens.$inferInsert)["purpose"], opts: { userId?: string; minutes: number; meta?: Record<string, unknown> }) {
    const token = Tokens.generate();
    await tx.insert(oneTimeTokens).values({
      schoolId: this.schoolId, purpose, tokenHash: Tokens.hash(token), userId: opts.userId ?? null,
      meta: opts.meta ?? {}, expiresAt: new Date(Date.now() + opts.minutes * 60_000),
    });
    return token;
  }

  /** Marks the token used and returns its row, or null if unknown, used or expired. */
  async consumeToken(tx: Tx, purpose: (typeof oneTimeTokens.$inferInsert)["purpose"], token: string) {
    const [row] = await tx.update(oneTimeTokens).set({ usedAt: new Date() }).where(and(
      eq(oneTimeTokens.tokenHash, Tokens.hash(token)), eq(oneTimeTokens.purpose, purpose),
      isNull(oneTimeTokens.usedAt), gt(oneTimeTokens.expiresAt, new Date()),
    )).returning();
    return row ?? null;
  }

  /** Exchange a console-issued support token for a 30-minute session (read-only unless the owner allowed writes). Written to login_events as "support". */
  async supportLogin(token: string, meta: SignInMeta = {}) {
    try {
      return await withSchool(this.schoolId, async (tx) => {
        const row = await this.consumeToken(tx, "support_login", token);
        if (!row?.userId) throw new LoginError("invalid");
        const m = row.meta as { staffId: string; allowWrites?: boolean };
        const [u] = await tx.select({ loginId: users.loginId }).from(users).where(eq(users.id, row.userId)).limit(1);
        await tx.insert(loginEvents).values({
          schoolId: this.schoolId, userId: row.userId, identifier: (u?.loginId ?? "").toLowerCase().slice(0, 80), outcome: "support", method: "support",
          ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null, supportStaffId: m.staffId,
        });
        return this.createSession(tx, row.userId, { ...meta, supportStaffId: m.staffId, readOnly: !m.allowWrites, minutes: SUPPORT_SESSION_MINUTES });
      });
    } catch (e) {
      if (e instanceof LoginError) await this.logFailure("invalid", undefined, "support link", "support", meta);
      throw e;
    }
  }

  async resetPassword(token: string, next: string) {
    return withSchool(this.schoolId, async (tx) => {
      const row = await this.consumeToken(tx, "reset_password", token) ?? await this.consumeToken(tx, "invite", token);
      if (!row?.userId) throw new LoginError("invalid");
      await this.applyReset(tx, row.userId, next, "Set a new password from an email link");
      // The link was mailed to `meta.email`: using it proves that inbox, as long as the account still has that address.
      const sentTo = (row.meta as { email?: string } | null)?.email;
      if (sentTo) await tx.update(users).set({ emailVerifiedAt: new Date() }).where(and(eq(users.id, row.userId), sql`lower(${users.email}) = ${sentTo}`, isNull(users.emailVerifiedAt)));
      return row.userId;
    });
  }

  /** Policy, new hash, activate, clear must-change, end every session. Throwing rolls the transaction back, so a weak password does not use up the link or code. */
  private async applyReset(tx: Tx, userId: string, next: string, summary: string) {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new LoginError("invalid");
    await this.refuseIfNotOpen(tx, u);
    if (u.status === "disabled") throw new LoginError("disabled");
    await this.assertPolicy(tx, u, next);
    await tx.update(users).set({ passwordHash: await Passwords.hash(next), ...(u.status === "invited" ? { status: "active" as const } : {}), mustChangePassword: false }).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await this.audit(tx, userId, "reset_password", summary);
  }
}

// ---------- platform staff (console) ----------

export interface StaffSession { staffId: string; role: StaffRole; name: string; email: string; twoFactorPassed: boolean; totpEnabled: boolean }

export class StaffAuth {
  static totp(secret: string, label: string) {
    return new OTPAuth.TOTP({ issuer: "Triakshi Console", label, algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  }
  static newTotpSecret() { return new OTPAuth.Secret({ size: 20 }).base32; }
  static checkTotp(secret: string, code: string, label = "staff") {
    return StaffAuth.totp(secret, label).validate({ token: code.replace(/\s/g, ""), window: 1 }) !== null;
  }

  /** Step 1: password. Returns a token whose session still needs the TOTP step. */
  static async login(email: string, password: string, ip = "?") {
    const e = email.trim().toLowerCase();
    if (!loginLimiter.take(`staff-ip:${ip}`) || !loginLimiter.take(`staff:${e}`)) throw new LoginError("rate_limited");
    return withConsole(async (tx) => {
      const [s] = await tx.select().from(platformStaff).where(sql`lower(${platformStaff.email}) = ${e}`).limit(1);
      if (!s || !(await Passwords.verify(s.passwordHash, password))) throw new LoginError("invalid");
      if (s.status !== "active") throw new LoginError("disabled");
      const token = Tokens.generate();
      await tx.insert(staffSessions).values({ staffId: s.id, tokenHash: Tokens.hash(token), expiresAt: new Date(Date.now() + 12 * 3_600_000) });
      return { token, totpEnabled: s.totpEnabled };
    });
  }

  /** Step 2: TOTP code. On first login this also enrols the secret shown as a QR code. */
  static async verifyTwoFactor(token: string, code: string, enrolSecret?: string) {
    return withConsole(async (tx) => {
      const [row] = await tx.select({ ss: staffSessions, s: platformStaff }).from(staffSessions)
        .innerJoin(platformStaff, eq(platformStaff.id, staffSessions.staffId))
        .where(and(eq(staffSessions.tokenHash, Tokens.hash(token)), gt(staffSessions.expiresAt, new Date()))).limit(1);
      if (!row) return false;
      const secret = row.s.totpEnabled ? row.s.totpSecret : enrolSecret;
      if (!secret || !StaffAuth.checkTotp(secret, code, row.s.email)) return false;
      if (!row.s.totpEnabled) await tx.update(platformStaff).set({ totpSecret: secret, totpEnabled: true }).where(eq(platformStaff.id, row.s.id));
      await tx.update(staffSessions).set({ twoFactorPassed: true }).where(eq(staffSessions.id, row.ss.id));
      await tx.update(platformStaff).set({ lastLoginAt: new Date() }).where(eq(platformStaff.id, row.s.id));
      return true;
    });
  }

  static async validate(token: string | undefined | null): Promise<StaffSession | null> {
    if (!token) return null;
    return withConsole(async (tx) => {
      const [row] = await tx.select({ ss: staffSessions, s: platformStaff }).from(staffSessions)
        .innerJoin(platformStaff, eq(platformStaff.id, staffSessions.staffId))
        .where(and(eq(staffSessions.tokenHash, Tokens.hash(token)), gt(staffSessions.expiresAt, new Date()))).limit(1);
      if (!row || row.s.status !== "active") return null;
      return { staffId: row.s.id, role: row.s.role, name: row.s.name, email: row.s.email, twoFactorPassed: row.ss.twoFactorPassed, totpEnabled: row.s.totpEnabled };
    });
  }

  static async logout(token: string | undefined | null) {
    if (!token) return;
    await withConsole((tx) => tx.delete(staffSessions).where(eq(staffSessions.tokenHash, Tokens.hash(token))));
  }
}
