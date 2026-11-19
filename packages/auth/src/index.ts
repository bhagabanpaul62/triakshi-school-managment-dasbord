/**
 * Identity: password hashing, school sessions, console staff sessions with TOTP, one-time tokens, rate limits.
 * Framework-free; @smw/runtime puts the tokens in cookies.
 * @module @smw/auth
 */
import { argon2, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import * as OTPAuth from "otpauth";
import {
  and, eq, gt, isNull, oneTimeTokens, or, platformStaff, sessions, sql, staffSessions, users,
  withConsole, withSchool, type SchoolRole, type StaffRole, type Tx,
} from "@smw/db";

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
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  /** True when the call is allowed. */
  take(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) { this.hits.set(key, { count: 1, resetAt: now + this.windowMs }); return true; }
    h.count++;
    return h.count <= this.limit;
  }
  reset(key: string) { this.hits.delete(key); }
}

/** 10 login attempts per 15 minutes per IP and per account. */
export const loginLimiter = new RateLimiter(10, 15 * 60_000);

// ---------- school users ----------

export interface SessionUser { id: string; schoolId: string; role: SchoolRole; name: string; email: string | null; avatarUrl: string | null }
export interface ValidSession { sessionId: string; user: SessionUser; readOnly: boolean; supportStaffId: string | null; expiresAt: Date }

export class LoginError extends Error {
  constructor(readonly reason: "invalid" | "rate_limited" | "disabled") { super(reason); }
}

/** Sessions for one school. Every method runs inside that school's RLS scope. */
export class SchoolAuth {
  constructor(private readonly schoolId: string) {}

  /** Log in by email, phone or login ID (admission number for students). Returns the raw session token. */
  async login(identifier: string, password: string, meta: { ip?: string; userAgent?: string } = {}) {
    const id = identifier.trim().toLowerCase();
    if (!loginLimiter.take(`ip:${meta.ip ?? "?"}`) || !loginLimiter.take(`acct:${this.schoolId}:${id}`)) throw new LoginError("rate_limited");
    return withSchool(this.schoolId, async (tx) => {
      const [user] = await tx.select().from(users).where(or(
        sql`lower(${users.loginId}) = ${id}`, sql`lower(${users.email}) = ${id}`, eq(users.phone, identifier.trim()),
      )).limit(1);
      if (!user || !(await Passwords.verify(user.passwordHash, password))) throw new LoginError("invalid");
      if (user.status !== "active") throw new LoginError("disabled");
      loginLimiter.reset(`acct:${this.schoolId}:${id}`);
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      return this.createSession(tx, user.id, { ...meta });
    });
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
      const [row] = await tx.select({ s: sessions, u: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, Tokens.hash(token)), gt(sessions.expiresAt, new Date()))).limit(1);
      if (!row || row.u.status !== "active") return null;
      let expiresAt = row.s.expiresAt;
      if (!row.s.supportStaffId && Date.now() - row.s.lastSeenAt.getTime() > DAY) {
        expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
        await tx.update(sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, row.s.id));
      }
      return {
        sessionId: row.s.id, readOnly: row.s.readOnly, supportStaffId: row.s.supportStaffId, expiresAt,
        user: { id: row.u.id, schoolId: row.u.schoolId, role: row.u.role, name: row.u.name, email: row.u.email, avatarUrl: row.u.avatarUrl },
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

  async changePassword(userId: string, current: string, next: string) {
    return withSchool(this.schoolId, async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!u || !(await Passwords.verify(u.passwordHash, current))) throw new LoginError("invalid");
      await tx.update(users).set({ passwordHash: await Passwords.hash(next) }).where(eq(users.id, userId));
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

  /** Exchange a console-issued support token for a 30-minute session (read-only unless the owner allowed writes). */
  async supportLogin(token: string, meta: { ip?: string; userAgent?: string } = {}) {
    return withSchool(this.schoolId, async (tx) => {
      const row = await this.consumeToken(tx, "support_login", token);
      if (!row?.userId) throw new LoginError("invalid");
      const m = row.meta as { staffId: string; allowWrites?: boolean };
      return this.createSession(tx, row.userId, { ...meta, supportStaffId: m.staffId, readOnly: !m.allowWrites, minutes: SUPPORT_SESSION_MINUTES });
    });
  }

  async resetPassword(token: string, next: string) {
    return withSchool(this.schoolId, async (tx) => {
      const row = await this.consumeToken(tx, "reset_password", token) ?? await this.consumeToken(tx, "invite", token);
      if (!row?.userId) throw new LoginError("invalid");
      await tx.update(users).set({ passwordHash: await Passwords.hash(next), status: "active" }).where(eq(users.id, row.userId));
      await tx.delete(sessions).where(eq(sessions.userId, row.userId));
      return row.userId;
    });
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
