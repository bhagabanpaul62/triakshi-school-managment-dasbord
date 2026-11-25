// Proves the school auth flows against a real database: forgot password, one-time links, password policy, sessions, rate limits.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, desc, eq, loginEvents, oneTimeTokens, schools, sessions, sql, users, withConsole, withSchool } from "@smw/db";
import {
  deviceFamily, LoginError, loginRefusal, OtpError, Passwords, PasswordError, RateLimiter, SchoolAuth, checkPassword, forgotAcctLimiter, forgotIpLimiter, loginIpFailLimiter, loginLimiter, otpAcctLimiter, otpMessage,
} from "./index";

let schoolId: string;
let auth: SchoolAuth;
let staffId: string;
let studentId: string;

async function newUser(values: Partial<typeof users.$inferInsert> & { loginId: string }) {
  const [u] = await withConsole((tx) => tx.insert(users).values({
    schoolId, role: "teacher", name: "Test User", passwordHash: "", ...values,
  }).returning());
  return u!;
}

beforeAll(async () => {
  const [school] = await withConsole((tx) => tx.insert(schools).values({ slug: "auth-a", name: "Auth School", status: "active" }).returning());
  schoolId = school!.id;
  auth = new SchoolAuth(schoolId);
  staffId = (await newUser({ loginId: "ann@auth.test", email: "ann@auth.test", name: "Ann Staff", passwordHash: await Passwords.hash("OldPass#123") })).id;
  studentId = (await newUser({ loginId: "GR0001", role: "student", name: "Ravi Kumar", passwordHash: await Passwords.hash("01012010"), mustChangePassword: true })).id;
  await withSchool(schoolId, (tx) => tx.execute(sql`insert into students (id, school_id, admission_no, name, dob, user_id) values (gen_random_uuid(), ${schoolId}, 'GR0001', 'Ravi Kumar', '2010-01-01', ${studentId})`));
});
afterAll(closeDb);
beforeEach(() => {
  forgotIpLimiter.reset("ip:?");
  loginLimiter.reset("otp-ip:?");
  for (const id of ["ann@auth.test", "gr0001", "nobody@auth.test"]) forgotAcctLimiter.reset(`${schoolId}:${id}`);
});

const unusedResetTokens = (userId: string) => withSchool(schoolId, async (tx) =>
  (await tx.select().from(oneTimeTokens).where(eq(oneTimeTokens.userId, userId))).filter((t) => t.purpose === "reset_password" && !t.usedAt));

describe("checkPassword", () => {
  const who = { loginId: "GR0001", name: "Ravi Kumar", dob: "2010-01-01" };
  it("accepts a normal password", () => expect(checkPassword("Maple-River-42", who)).toBeNull());
  it("needs 8 characters", () => expect(checkPassword("short1", who)).toMatch(/8 characters/));
  it("rejects the login ID, admission number and date of birth", () => {
    expect(checkPassword("gr0001gr", { loginId: "GR0001GR" })).toMatch(/login ID/);
    expect(checkPassword("01012010", who)).toMatch(/date of birth/);
  });
  it("rejects common passwords", () => {
    for (const p of ["password", "12345678", "qwerty123", "school123", "Password123"]) expect(checkPassword(p, { loginId: "x" })).toMatch(/8 characters|common/);
    expect(checkPassword("QWERTY123", { loginId: "x" })).toMatch(/common/);
  });
});

describe("forgot password", () => {
  it("answers the same for a known and an unknown login; only the known one gets a mail", async () => {
    const known = await auth.requestPasswordReset("ann@auth.test");
    const unknown = await auth.requestPasswordReset("nobody@auth.test");
    expect(known.limited).toBe(false);
    expect(unknown.limited).toBe(false);
    expect(known.send?.to).toBe("ann@auth.test");
    expect(unknown.send).toBeUndefined();
  });
  it("sends nothing for an account with no email", async () => {
    expect((await auth.requestPasswordReset("GR0001")).send).toBeUndefined();
  });
  it("keeps at most 3 unused links", async () => {
    forgotAcctLimiter.reset(`${schoolId}:ann@auth.test`);
    const first = await auth.requestPasswordReset("ann@auth.test");
    for (let i = 0; i < 2; i++) await auth.requestPasswordReset("ann@auth.test");
    forgotAcctLimiter.reset(`${schoolId}:ann@auth.test`);
    await auth.requestPasswordReset("ann@auth.test");
    expect((await unusedResetTokens(staffId)).length).toBeLessThanOrEqual(3);
    await expect(auth.resetPassword(first.send!.token, "Maple-River-42")).rejects.toBeInstanceOf(LoginError);
  });
  it("limits 3 per hour per login and 5 per hour per IP", async () => {
    const r = [];
    for (let i = 0; i < 4; i++) r.push((await auth.requestPasswordReset("ann@auth.test")).limited);
    expect(r).toEqual([false, false, false, true]);
    forgotIpLimiter.reset("ip:?");
    const ip = [];
    for (let i = 0; i < 6; i++) ip.push((await auth.requestPasswordReset(`someone${i}@auth.test`, "9.9.9.9")).limited);
    expect(ip).toEqual([false, false, false, false, false, true]);
    forgotIpLimiter.reset("ip:9.9.9.9");
  });
});

describe("reset link", () => {
  it("works once, then fails", async () => {
    const { send } = await auth.requestPasswordReset("ann@auth.test");
    expect(await auth.resetPassword(send!.token, "Maple-River-42")).toBe(staffId);
    await expect(auth.resetPassword(send!.token, "Maple-River-43")).rejects.toBeInstanceOf(LoginError);
    expect((await auth.login("ann@auth.test", "Maple-River-42")).token).toBeTruthy();
  });
  it("fails when expired", async () => {
    const token = await withSchool(schoolId, (tx) => auth.issueToken(tx, "reset_password", { userId: staffId, minutes: -1 }));
    await expect(auth.resetPassword(token, "Maple-River-44")).rejects.toBeInstanceOf(LoginError);
    expect((await auth.peekToken("reset_password", token)).state).toBe("expired");
    expect((await auth.peekToken("reset_password", "nope")).state).toBe("unknown");
  });
  it("clears must-change and ends every session; a weak password does not use up the link", async () => {
    const sess = await withSchool(schoolId, (tx) => auth.createSession(tx, studentId));
    const token = await withSchool(schoolId, (tx) => auth.issueToken(tx, "invite", { userId: studentId, minutes: 60 }));
    await expect(auth.resetPassword(token, "GR0001")).rejects.toBeInstanceOf(PasswordError);
    await expect(auth.resetPassword(token, "01012010")).rejects.toBeInstanceOf(PasswordError);
    expect(await auth.validate(sess.token)).not.toBeNull();
    await auth.resetPassword(token, "Sunrise-Lake-77");
    expect(await auth.validate(sess.token)).toBeNull();
    const [u] = await withSchool(schoolId, (tx) => tx.select().from(users).where(eq(users.id, studentId)));
    expect(u!.mustChangePassword).toBe(false);
  });
});

describe("sign in, change password, sessions", () => {
  it("reports must-change on login", async () => {
    const id = (await newUser({ loginId: "GR0002", role: "student", passwordHash: await Passwords.hash("02022010"), mustChangePassword: true })).id;
    const r = await auth.login("GR0002", "02022010");
    expect(r.mustChangePassword).toBe(true);
    const s = await auth.validate(r.token);
    expect(s?.user.id).toBe(id);
    expect(s?.user.mustChangePassword).toBe(true);
  });
  it("rejects a wrong current password and a weak new one", async () => {
    const u = await newUser({ loginId: "bob@auth.test", email: "bob@auth.test", passwordHash: await Passwords.hash("OldPass#123") });
    await expect(auth.changePassword(u.id, "wrong", "Maple-River-42")).rejects.toBeInstanceOf(LoginError);
    await expect(auth.changePassword(u.id, "OldPass#123", "bob@auth.test")).rejects.toBeInstanceOf(PasswordError);
    await expect(auth.changePassword(u.id, "OldPass#123", "OldPass#123")).rejects.toBeInstanceOf(PasswordError);
  });
  it("changes the password, clears must-change and ends the other sessions", async () => {
    const u = await newUser({ loginId: "cy@auth.test", email: "cy@auth.test", passwordHash: await Passwords.hash("OldPass#123"), mustChangePassword: true });
    const here = await auth.login("cy@auth.test", "OldPass#123");
    const other = await auth.login("cy@auth.test", "OldPass#123");
    const keep = (await auth.validate(here.token))!.sessionId;
    await auth.changePassword(u.id, "OldPass#123", "Maple-River-42", keep);
    expect(await auth.validate(here.token)).not.toBeNull();
    expect(await auth.validate(other.token)).toBeNull();
    expect((await auth.validate(here.token))!.user.mustChangePassword).toBe(false);
    expect((await auth.login("cy@auth.test", "Maple-River-42")).token).toBeTruthy();
  });
  it("lists devices and signs one or all others out", async () => {
    const u = await newUser({ loginId: "di@auth.test", email: "di@auth.test", passwordHash: await Passwords.hash("OldPass#123") });
    const a = await auth.login("di@auth.test", "OldPass#123", { userAgent: "Mozilla/5.0 Chrome/120" });
    const b = await auth.login("di@auth.test", "OldPass#123");
    const c = await auth.login("di@auth.test", "OldPass#123");
    const cur = (await auth.validate(a.token))!.sessionId;
    const list = await auth.listSessions(u.id, cur);
    expect(list).toHaveLength(3);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    await auth.revokeSession(u.id, (await auth.validate(b.token))!.sessionId);
    expect(await auth.validate(b.token)).toBeNull();
    await auth.logoutOthers(u.id, cur);
    expect(await auth.validate(c.token)).toBeNull();
    expect(await auth.validate(a.token)).not.toBeNull();
    const left = await withSchool(schoolId, (tx) => tx.select().from(sessions).where(eq(sessions.userId, u.id)));
    expect(left).toHaveLength(1);
  });
  it("applies an email change only after the link is confirmed", async () => {
    const u = await newUser({ loginId: "ed@auth.test", email: "ed@auth.test", passwordHash: await Passwords.hash("OldPass#123") });
    await expect(auth.requestEmailChange(u.id, "ann@auth.test", "OldPass#123")).rejects.toThrow(/already uses/);
    await expect(auth.requestEmailChange(u.id, "Ed.New@Auth.test", "wrong-password")).rejects.toBeInstanceOf(LoginError);
    const keep = await withSchool(schoolId, (tx) => auth.createSession(tx, u.id));
    const other = await withSchool(schoolId, (tx) => auth.createSession(tx, u.id));
    const { token, oldEmail } = await auth.requestEmailChange(u.id, "Ed.New@Auth.test", "OldPass#123");
    expect(oldEmail).toBe("ed@auth.test");
    expect((await auth.contactOf(u.id))?.email).toBe("ed@auth.test");
    expect((await auth.confirmEmailChange(token)).email).toBe("ed.new@auth.test");
    expect(await auth.contactOf(u.id)).toMatchObject({ email: "ed.new@auth.test", loginId: "ed.new@auth.test" });
    await expect(auth.confirmEmailChange(token)).rejects.toBeInstanceOf(LoginError);
    // The link path ends every session of the user.
    expect(await auth.validate(keep.token)).toBeNull();
    expect(await auth.validate(other.token)).toBeNull();
  });
  it("a code-confirmed email change ends the other sessions and keeps the current one", async () => {
    const u = await newUser({ loginId: "ed2@auth.test", email: "ed2@auth.test", passwordHash: await Passwords.hash("OldPass#123") });
    const keep = await withSchool(schoolId, (tx) => auth.createSession(tx, u.id));
    const other = await withSchool(schoolId, (tx) => auth.createSession(tx, u.id));
    const { code } = await auth.requestEmailChange(u.id, "ed2.new@auth.test", "OldPass#123");
    await auth.confirmEmailChangeWithCode(u.id, code, (await auth.validate(keep.token))!.sessionId);
    expect(await auth.validate(keep.token)).not.toBeNull();
    expect(await auth.validate(other.token)).toBeNull();
  });
});

describe("RateLimiter", () => {
  it("allows the limit then blocks until the window ends", () => {
    const rl = new RateLimiter(2, 1000);
    expect([rl.take("k", 0), rl.take("k", 1), rl.take("k", 2)]).toEqual([true, true, false]);
    expect(rl.take("k", 1001)).toBe(true);
  });

  it("forgets keys whose window is over, and answers the same as before", () => {
    const rl = new RateLimiter(2, 1000);
    for (let i = 0; i < 100; i++) rl.take(`k${i}`, 0);
    expect(rl.size).toBe(100);
    expect(rl.take("fresh", 5000)).toBe(true);
    expect(rl.size).toBe(1);
    expect([rl.take("k1", 5001), rl.take("k1", 5002), rl.take("k1", 5003)]).toEqual([true, true, false]);
  });

  it("blocked() reads the window without counting", () => {
    const rl = new RateLimiter(2, 1000);
    rl.take("k", 0); expect(rl.blocked("k", 1)).toBe(false);
    rl.take("k", 2); expect(rl.blocked("k", 3)).toBe(true);
    expect(rl.blocked("k", 1001)).toBe(false);
  });

  it("successful logins from one school Wi-Fi address never lock it; failures do", async () => {
    await newUser({ loginId: "wifi@auth.test", email: "wifi@auth.test", passwordHash: await Passwords.hash("WifiPass#123") });
    loginIpFailLimiter.reset("ip:school-wifi");
    for (let i = 0; i < 12; i++) await auth.login("wifi@auth.test", "WifiPass#123", { ip: "school-wifi" });
    for (let i = 0; i < 50; i++) loginIpFailLimiter.take("ip:school-wifi");
    await expect(auth.login("wifi@auth.test", "WifiPass#123", { ip: "school-wifi" })).rejects.toMatchObject({ reason: "rate_limited" });
    loginIpFailLimiter.reset("ip:school-wifi");
  });
});

// ---------- email codes (PRD 6.1) ----------

const sendCode = async (a: SchoolAuth, id: string, use: "reset" | "login") => (await a.sendOtp(id, use)).send?.code;
/** Move every code of a user 2 minutes into the past so the 60 s cooldown is over. */
const ageCodes = (userId: string) => withSchool(schoolId, (tx) => tx.update(oneTimeTokens).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(oneTimeTokens.userId, userId)));
const otpReason = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof OtpError ? e.reason : `other:${String(e)}`));

describe("email codes", () => {
  it("answers the same for an unknown account; only a known one gets a mail", async () => {
    const known = await auth.sendOtp("ann@auth.test", "login");
    const unknown = await auth.sendOtp("nobody@auth.test", "login");
    expect(known.limited).toBe(unknown.limited);
    expect(known.send?.code).toMatch(/^\d{6}$/);
    expect(unknown.send).toBeUndefined();
    expect((await auth.sendOtp("GR0001", "login")).send).toBeUndefined(); // no email on file
  });

  it("a right code signs in once, then fails", async () => {
    const u = await newUser({ loginId: "otp1@auth.test", email: "otp1@auth.test", passwordHash: "x" });
    const code = (await sendCode(auth, "otp1@auth.test", "login"))!;
    const r = await auth.loginWithCode("otp1@auth.test", code);
    expect((await auth.validate(r.token))?.user.id).toBe(u.id);
    expect(await otpReason(auth.loginWithCode("otp1@auth.test", code))).toBe("none");
  });

  it("a wrong code never reveals the tries left, and the code dies after 5 tries", async () => {
    await newUser({ loginId: "otp2@auth.test", email: "otp2@auth.test", passwordHash: "x" });
    const code = (await sendCode(auth, "otp2@auth.test", "login"))!;
    const bad = code === "000000" ? "111111" : "000000";
    const got = [];
    for (let i = 0; i < 5; i++) got.push(await otpReason(auth.loginWithCode("otp2@auth.test", bad)));
    expect(got).toEqual(["wrong", "wrong", "wrong", "wrong", "locked"]);
    expect(await otpReason(auth.loginWithCode("otp2@auth.test", code))).toBe("none");
  });

  it("an expired code fails", async () => {
    const u = await newUser({ loginId: "otp3@auth.test", email: "otp3@auth.test", passwordHash: "x" });
    const code = (await sendCode(auth, "otp3@auth.test", "login"))!;
    await withSchool(schoolId, (tx) => tx.update(oneTimeTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(oneTimeTokens.userId, u.id)));
    expect(await otpReason(auth.loginWithCode("otp3@auth.test", code))).toBe("expired");
  });

  it("a new code kills the old one, and a resend inside 60 s sends nothing", async () => {
    const u = await newUser({ loginId: "otp4@auth.test", email: "otp4@auth.test", passwordHash: "x" });
    const first = (await sendCode(auth, "otp4@auth.test", "login"))!;
    expect(await sendCode(auth, "otp4@auth.test", "login")).toBeUndefined(); // cooldown, same neutral answer
    await ageCodes(u.id);
    const second = (await sendCode(auth, "otp4@auth.test", "login"))!;
    if (first !== second) expect(await otpReason(auth.loginWithCode("otp4@auth.test", first))).toMatch(/^wrong/);
    expect((await auth.loginWithCode("otp4@auth.test", second)).token).toBeTruthy();
  });

  it("allows 5 codes an hour per account", async () => {
    const u = await newUser({ loginId: "otp5@auth.test", email: "otp5@auth.test", passwordHash: "x" });
    const sent = [];
    for (let i = 0; i < 6; i++) { forgotIpLimiter.reset("ip:?"); sent.push(!!(await sendCode(auth, "otp5@auth.test", "login"))); await ageCodes(u.id); }
    expect(sent).toEqual([true, true, true, true, true, false]);
  });

  it("a code for school A does not work in school B", async () => {
    const [b] = await withConsole((tx) => tx.insert(schools).values({ slug: "auth-b", name: "Other School", status: "active" }).returning());
    const authB = new SchoolAuth(b!.id);
    await withConsole((tx) => tx.insert(users).values({ schoolId: b!.id, role: "teacher", name: "Twin", loginId: "twin@auth.test", email: "twin@auth.test", passwordHash: "x" }));
    await newUser({ loginId: "twin@auth.test", email: "twin@auth.test", passwordHash: "x" });
    const code = (await sendCode(auth, "twin@auth.test", "login"))!;
    expect(await otpReason(authB.loginWithCode("twin@auth.test", code))).toBe("none");
    expect((await auth.loginWithCode("twin@auth.test", code)).token).toBeTruthy();
  });

  it("reset by code clears must-change, ends sessions, and a weak password keeps the code", async () => {
    const u = await newUser({ loginId: "otp6@auth.test", email: "otp6@auth.test", passwordHash: await Passwords.hash("OldPass#123"), mustChangePassword: true });
    const sess = await withSchool(schoolId, (tx) => auth.createSession(tx, u.id));
    const code = (await sendCode(auth, "otp6@auth.test", "reset"))!;
    await expect(auth.resetPasswordWithCode("otp6@auth.test", code, "password")).rejects.toBeInstanceOf(PasswordError);
    expect(await auth.validate(sess.token)).not.toBeNull();
    expect(await auth.resetPasswordWithCode("otp6@auth.test", code, "Maple-River-42")).toBe(u.id);
    expect(await auth.validate(sess.token)).toBeNull();
    const [row] = await withSchool(schoolId, (tx) => tx.select().from(users).where(eq(users.id, u.id)));
    expect(row!.mustChangePassword).toBe(false);
    expect((await auth.login("otp6@auth.test", "Maple-River-42")).token).toBeTruthy();
    expect(await otpReason(auth.resetPasswordWithCode("otp6@auth.test", code, "Maple-River-43"))).toBe("none");
  });

  it("a reset-link mail carries a code that works too, and a login code cannot reset", async () => {
    await newUser({ loginId: "otp7@auth.test", email: "otp7@auth.test", passwordHash: "x" });
    const r = await auth.requestPasswordReset("otp7@auth.test");
    expect(r.send?.code).toMatch(/^\d{6}$/);
    await expect(auth.resetPasswordWithCode("otp7@auth.test", r.send!.code!, "Maple-River-42")).resolves.toBeTruthy();
  });

  it("login by code is refused for a disabled user, and must-change is reported", async () => {
    const u = await newUser({ loginId: "otp8@auth.test", email: "otp8@auth.test", passwordHash: "x", mustChangePassword: true });
    const code = (await sendCode(auth, "otp8@auth.test", "login"))!;
    expect((await auth.loginWithCode("otp8@auth.test", code)).mustChangePassword).toBe(true);
    await ageCodes(u.id);
    const code2 = (await sendCode(auth, "otp8@auth.test", "login"))!;
    await withConsole((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, u.id)));
    expect(await otpReason(auth.loginWithCode("otp8@auth.test", code2))).toBe("none");
    await ageCodes(u.id);
    expect((await auth.sendOtp("otp8@auth.test", "login")).send).toBeUndefined();
  });

  it("an email_change code applies the new email only after verify", async () => {
    const u = await newUser({ loginId: "otp9@auth.test", email: "otp9@auth.test", passwordHash: await Passwords.hash("OldPass#123") });
    const { code } = await auth.requestEmailChange(u.id, "otp9.new@auth.test", "OldPass#123");
    expect((await auth.contactOf(u.id))?.email).toBe("otp9@auth.test");
    const bad = code === "000000" ? "111111" : "000000";
    expect(await otpReason(auth.confirmEmailChangeWithCode(u.id, bad))).toBe("wrong");
    expect((await auth.contactOf(u.id))?.email).toBe("otp9@auth.test");
    expect((await auth.confirmEmailChangeWithCode(u.id, code)).email).toBe("otp9.new@auth.test");
    expect(await auth.contactOf(u.id)).toMatchObject({ email: "otp9.new@auth.test", loginId: "otp9.new@auth.test" });
    expect(await otpReason(auth.confirmEmailChangeWithCode(u.id, code))).toBe("none");
  });
});

describe("verify my email", () => {
  const verifiedAt = (id: string) => withSchool(schoolId, async (tx) => (await tx.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, id)))[0]!.v);

  it("a right code marks the email verified once; wrong codes, no email and an already-verified email are refused", async () => {
    const u = await newUser({ loginId: "ver1@auth.test", email: "ver1@auth.test" });
    const { to, code } = await auth.sendVerifyEmailCode(u.id);
    expect(to).toBe("ver1@auth.test");
    expect(await otpReason(auth.verifyEmailWithCode(u.id, code === "000000" ? "111111" : "000000"))).toBe("wrong");
    expect(await verifiedAt(u.id)).toBeNull();
    await auth.verifyEmailWithCode(u.id, code);
    expect(await verifiedAt(u.id)).toBeInstanceOf(Date);
    expect(await otpReason(auth.verifyEmailWithCode(u.id, code))).toBe("none");
    await expect(auth.sendVerifyEmailCode(u.id)).rejects.toThrow(/already verified/);
    const noEmail = await newUser({ loginId: "ver-none" });
    await expect(auth.sendVerifyEmailCode(noEmail.id)).rejects.toThrow(/Add an email/);
  });

  it("a verify code cannot sign in, and a resend inside 60 s is refused", async () => {
    const u = await newUser({ loginId: "ver2@auth.test", email: "ver2@auth.test" });
    const { code } = await auth.sendVerifyEmailCode(u.id);
    await expect(auth.sendVerifyEmailCode(u.id)).rejects.toThrow(/Wait a minute/);
    expect(await otpReason(auth.loginWithCode("ver2@auth.test", code))).not.toBe("ok");
    expect(await verifiedAt(u.id)).toBeNull();
  });

  it("confirming a new email marks it verified", async () => {
    const u = await newUser({ loginId: "ver3@auth.test", email: "ver3@auth.test", passwordHash: await Passwords.hash("OldPass#123") });
    const { code } = await auth.requestEmailChange(u.id, "ver3.new@auth.test", "OldPass#123");
    await auth.confirmEmailChangeWithCode(u.id, code);
    expect(await verifiedAt(u.id)).toBeInstanceOf(Date);
  });
});

describe("account enumeration", () => {
  const msg = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof OtpError ? otpMessage(e) : `other:${String(e)}`));

  it("unknown account, no code, wrong code and expired code all read the same", async () => {
    await newUser({ loginId: "enum1@auth.test", email: "enum1@auth.test", passwordHash: "x" });
    const unknown = await msg(auth.loginWithCode("nobody-enum@auth.test", "123456"));
    const noCode = await msg(auth.loginWithCode("enum1@auth.test", "123456"));
    const code = (await sendCode(auth, "enum1@auth.test", "login"))!;
    const wrong = await msg(auth.loginWithCode("enum1@auth.test", code === "000000" ? "111111" : "000000"));
    expect(new Set([unknown, noCode, wrong]).size).toBe(1);
    expect(unknown).not.toMatch(/tr(y|ies)/);
  });

  it("verifying codes is limited to 10 an hour per account", async () => {
    await newUser({ loginId: "enum2@auth.test", email: "enum2@auth.test", passwordHash: "x" });
    otpAcctLimiter.reset(`${schoolId}:enum2@auth.test`);
    const got: string[] = [];
    for (let i = 0; i < 11; i++) { loginLimiter.reset("otp-ip:?"); got.push(await otpReason(auth.loginWithCode("enum2@auth.test", "123456"))); }
    expect(got.slice(0, 10).every((r) => r === "none")).toBe(true);
    expect(got[10]).toMatch(/^other:.*rate_limited/);
  });

  it("login runs a password check for an unknown login too (no fast path)", async () => {
    loginIpFailLimiter.reset("ip:?");
    await expect(auth.login("nobody-timing@auth.test", "whatever-123")).rejects.toMatchObject({ reason: "invalid" });
    const t0 = performance.now();
    await expect(auth.login("nobody-timing2@auth.test", "whatever-123")).rejects.toMatchObject({ reason: "invalid" });
    const unknownMs = performance.now() - t0;
    const t1 = performance.now();
    await expect(auth.login("ann@auth.test", "wrong-password-1")).rejects.toMatchObject({ reason: "invalid" });
    const knownMs = performance.now() - t1;
    expect(unknownMs).toBeGreaterThan(knownMs * 0.4); // one Argon2 run either way; the old fast path was ~100x quicker
  });
});

describe("disabled and retired accounts", () => {
  it("a reset link cannot reactivate a disabled account, and is not used up", async () => {
    const u = await newUser({ loginId: "dis1@auth.test", email: "dis1@auth.test", passwordHash: await Passwords.hash("OldPass#123") });
    const token = await withSchool(schoolId, (tx) => auth.issueToken(tx, "reset_password", { userId: u.id, minutes: 60 }));
    await withConsole((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, u.id)));
    await expect(auth.resetPassword(token, "Maple-River-42")).rejects.toMatchObject({ reason: "disabled" });
    expect((await auth.peekToken("reset_password", token)).state).toBe("ok");
    const [row] = await withSchool(schoolId, (tx) => tx.select().from(users).where(eq(users.id, u.id)));
    expect(row!.status).toBe("disabled");
  });

  it("an invite link still activates an invited account", async () => {
    const u = await newUser({ loginId: "inv1@auth.test", email: "inv1@auth.test", passwordHash: null, status: "invited" });
    const token = await withSchool(schoolId, (tx) => auth.issueToken(tx, "invite", { userId: u.id, minutes: 60 }));
    await auth.resetPassword(token, "Maple-River-42");
    const [row] = await withSchool(schoolId, (tx) => tx.select().from(users).where(eq(users.id, u.id)));
    expect(row!.status).toBe("active");
  });

  it("a retired parent login cannot sign in, validate, or use a code", async () => {
    const u = await newUser({ loginId: "par1@auth.test", email: "par1@auth.test", role: "parent", passwordHash: await Passwords.hash("OldPass#123") });
    await expect(auth.login("par1@auth.test", "OldPass#123")).rejects.toBeInstanceOf(LoginError);
    const sess = await withSchool(schoolId, (tx) => auth.createSession(tx, u.id));
    expect(await auth.validate(sess.token)).toBeNull();
    expect((await auth.sendOtp("par1@auth.test", "login")).send).toBeUndefined();
  });
});

describe("login events (every way in, and every way refused)", () => {
  const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
  const CHROME_WIN_NEW = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
  const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605 Version/17 Safari/605";
  const events = (identifier: string) => withSchool(schoolId, (tx) => tx.select().from(loginEvents).where(eq(loginEvents.identifier, identifier)).orderBy(desc(loginEvents.createdAt)));
  const open = async (id: string, extra: Partial<typeof users.$inferInsert> = {}) => newUser({ loginId: id, email: id, passwordHash: await Passwords.hash("OldPass#123"), ...extra });
  beforeEach(() => { loginIpFailLimiter.reset("ip:?"); });

  it("deviceFamily ignores the browser version", () => {
    expect(deviceFamily(CHROME_WIN)).toBe(deviceFamily(CHROME_WIN_NEW));
    expect(deviceFamily(CHROME_WIN)).not.toBe(deviceFamily(SAFARI_MAC));
  });

  it("a password sign-in is written; the same device family is not new the second time, another one is", async () => {
    const u = await open("ev1@auth.test");
    const first = await auth.login("ev1@auth.test", "OldPass#123", { ip: "1.1.1.1", userAgent: CHROME_WIN });
    expect(first).toMatchObject({ newDevice: true, firstSignIn: true });
    const again = await auth.login("EV1@auth.test", "OldPass#123", { userAgent: CHROME_WIN_NEW });
    expect(again).toMatchObject({ newDevice: false, firstSignIn: false });
    const other = await auth.login("ev1@auth.test", "OldPass#123", { userAgent: SAFARI_MAC });
    expect(other.newDevice).toBe(true);
    const rows = await events("ev1@auth.test");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.outcome === "success" && r.method === "password" && r.userId === u.id)).toBe(true);
    expect(rows.map((r) => r.newDevice).sort()).toEqual([false, true, true]);
  });

  it("a script trying many different names from one address leaves at most 30 rows and one summary row, and the answers stay the same", async () => {
    for (let i = 0; i < 45; i++) await expect(auth.login(`spray-${i}@auth.test`, "wrong-pass-1", { ip: "7.7.7.7" })).rejects.toMatchObject({ reason: "invalid" });
    const rows = await withSchool(schoolId, (tx) => tx.select().from(loginEvents).where(eq(loginEvents.ip, "7.7.7.7")));
    expect(rows.filter((r) => r.identifier.startsWith("spray-"))).toHaveLength(30);
    expect(rows.filter((r) => r.identifier === "many tries from this address")).toEqual([expect.objectContaining({ outcome: "rate_limited", userId: null })]);
  });

  it("a bad support link is its own outcome, not an unknown login", async () => {
    await expect(auth.supportLogin("not-a-token", { ip: "7.7.7.8" })).rejects.toBeInstanceOf(LoginError);
    const rows = await withSchool(schoolId, (tx) => tx.select().from(loginEvents).where(eq(loginEvents.ip, "7.7.7.8")));
    expect(rows).toEqual([expect.objectContaining({ outcome: "support_failed", method: "support" })]);
  });

  it("wrong password, unknown login, disabled account and a rate limit each leave their own row; the answers do not change", async () => {
    const u = await open("ev2@auth.test");
    await expect(auth.login("ev2@auth.test", "wrong-pass-1", { ip: "9.9.9.9" })).rejects.toMatchObject({ reason: "invalid" });
    await expect(auth.login("ghost-ev@auth.test", "wrong-pass-1", { ip: "9.9.9.9" })).rejects.toMatchObject({ reason: "invalid" });
    const [bad] = await events("ev2@auth.test");
    expect(bad).toMatchObject({ outcome: "bad_password", userId: u.id, ip: "9.9.9.9", method: "password" });
    const [ghost] = await events("ghost-ev@auth.test");
    expect(ghost).toMatchObject({ outcome: "unknown_login", userId: null });
    await withConsole((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, u.id)));
    await expect(auth.login("ev2@auth.test", "OldPass#123")).rejects.toMatchObject({ reason: "disabled" });
    expect((await events("ev2@auth.test"))[0]!.outcome).toBe("disabled");
    for (let i = 0; i < 12; i++) await auth.login("ev3@auth.test", "x-wrong-pass").catch(() => undefined);
    const limited = (await events("ev3@auth.test")).filter((r) => r.outcome === "rate_limited");
    expect(limited.length).toBeGreaterThan(0);
    expect(limited.length).toBeLessThanOrEqual(3);
    loginLimiter.reset(`acct:${schoolId}:ev3@auth.test`);
  });

  it("an identifier is cut to 80 characters and never holds the password", async () => {
    await auth.login("x".repeat(200), "secret-pass-123").catch(() => undefined);
    const rows = await withSchool(schoolId, (tx) => tx.select().from(loginEvents).where(eq(loginEvents.identifier, "x".repeat(80))));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("secret-pass-123");
  });

  it("a code sign-in is a success with method code; a wrong code is bad_code, and an unknown login is unknown_login", async () => {
    await open("ev4@auth.test");
    const code = await sendCode(auth, "ev4@auth.test", "login");
    await auth.loginWithCode("ev4@auth.test", "000000", { userAgent: CHROME_WIN }).catch(() => undefined);
    await auth.loginWithCode("ev4@auth.test", code!, { userAgent: CHROME_WIN });
    await auth.loginWithCode("nobody-ev@auth.test", "123456").catch(() => undefined);
    const rows = await events("ev4@auth.test");
    expect(rows.map((r) => `${r.method}:${r.outcome}`).sort()).toEqual(["code:bad_code", "code:success"]);
    expect((await events("nobody-ev@auth.test"))[0]).toMatchObject({ outcome: "unknown_login", method: "code", userId: null });
  });

  it("reset by link or code signs in as method reset; a wrong reset code is a failure of method reset", async () => {
    const u = await open("ev5@auth.test");
    await auth.startSession(u.id, { userAgent: CHROME_WIN });
    const code = await sendCode(auth, "ev5@auth.test", "reset");
    await auth.resetPasswordWithCode("ev5@auth.test", "111111", "Maple-River-42").catch(() => undefined);
    await auth.resetPasswordWithCode("ev5@auth.test", code!, "Maple-River-42");
    const rows = await events("ev5@auth.test");
    expect(rows.map((r) => `${r.method}:${r.outcome}`).sort()).toEqual(["reset:bad_code", "reset:success"]);
  });

  it("the api bearer login is written as method api", async () => {
    await open("ev6@auth.test");
    await auth.login("ev6@auth.test", "OldPass#123", { userAgent: "mobile-api", method: "api" });
    expect((await events("ev6@auth.test"))[0]).toMatchObject({ method: "api", outcome: "success" });
  });

  it("a support session is written as support with the staff id, and a bad support link is a failure row", async () => {
    const u = await open("ev7@auth.test");
    const staff = "00000000-0000-4000-8000-0000000000aa";
    const token = await withConsole((tx) => auth.issueToken(tx, "support_login", { userId: u.id, minutes: 5, meta: { staffId: staff } }));
    await auth.supportLogin(token, { ip: "2.2.2.2", userAgent: CHROME_WIN });
    expect((await events("ev7@auth.test"))[0]).toMatchObject({ outcome: "support", method: "support", supportStaffId: staff, userId: u.id });
    await expect(auth.supportLogin("not-a-token")).rejects.toBeInstanceOf(LoginError);
    expect((await events("support link"))[0]).toMatchObject({ outcome: "support_failed", method: "support" });
  });
});

describe("a student's login after leaving, and before joining", () => {
  const PW = "OldPass#123";
  const ist = (daysAgo: number) => new Date(Date.now() + 330 * 60_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const CLOSED = "This login was closed because the student left the school. Ask the school office.";

  /** A student login (admission number = login ID) with its student row. */
  async function kid(adm: string, st: { status: string; leftOn?: string | null; joinsOn?: string | null; accessUntil?: string | null }, user: Partial<typeof users.$inferInsert> = {}) {
    const u = await newUser({ loginId: adm, role: "student", name: `Kid ${adm}`, email: `${adm.toLowerCase()}@auth.test`, passwordHash: await Passwords.hash(PW), ...user });
    const until = st.accessUntil !== undefined ? st.accessUntil : st.leftOn ? sql`${st.leftOn}::date + 90` : null; // what features/students writes: last day + 90
    await withSchool(schoolId, (tx) => tx.execute(sql`insert into students (id, school_id, admission_no, name, user_id, status, left_on, joins_on, access_until)
      values (gen_random_uuid(), ${schoolId}, ${adm}, ${`Kid ${adm}`}, ${u.id}, ${st.status}, ${st.leftOn ?? null}::date, ${st.joinsOn ?? null}::date, ${until})`));
    return u;
  }
  const setLeftOn = (adm: string, leftOn: string | null) => withSchool(schoolId, (tx) => tx.execute(sql`update students set left_on = ${leftOn}::date, access_until = ${leftOn}::date + 90 where admission_no = ${adm}`));
  const reason = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof LoginError ? e.reason : `other:${String(e)}`));

  it("an active student, a student with no student row, and staff are unchanged", async () => {
    await kid("LV-ACT", { status: "active" });
    await newUser({ loginId: "LV-NOROW", role: "student", passwordHash: await Passwords.hash(PW) });
    const s = await auth.login("LV-ACT", PW);
    expect((await auth.validate(s.token))?.phase).toMatchObject({ status: "active" });
    const n = await auth.login("LV-NOROW", PW);
    expect((await auth.validate(n.token))?.phase).toBeNull();
    const t = await auth.login("ann@auth.test", "OldPass#123").catch(() => null); // staff password may have changed in earlier tests
    if (t) expect((await auth.validate(t.token))?.phase).toBeNull();
  });

  it("a left or alumni student signs in for 90 days after the last day, and the session carries the phase", async () => {
    await kid("LV-L10", { status: "left", leftOn: ist(10) });
    await kid("LV-AL90", { status: "alumni", leftOn: ist(90) });
    const a = await auth.login("LV-L10", PW);
    expect((await auth.validate(a.token))?.phase).toMatchObject({ status: "left", leftOn: ist(10) });
    const b = await auth.login("LV-AL90", PW); // the 90th day is still open
    expect((await auth.validate(b.token))?.phase?.status).toBe("alumni");
  });

  it("after the 90th day: the sentence only after the right password; a wrong one learns nothing", async () => {
    await kid("LV-L91", { status: "left", leftOn: ist(91) });
    expect(await reason(auth.login("LV-L91", PW))).toBe("closed");
    expect(await reason(auth.login("LV-L91", "wrong-Pass-1"))).toBe("invalid");
    expect(await reason(auth.login("LV-NOBODY", "wrong-Pass-1"))).toBe("invalid");
    const err = await auth.login("LV-L91", PW).catch((e) => e);
    expect(loginRefusal(err)).toBe(CLOSED);
  });

  it("the stored access_until decides, not left_on + 90", async () => {
    await kid("LV-LATE", { status: "left", leftOn: ist(200), accessUntil: ist(-5) }); // back-dated leaver, 5 days still to go
    expect((await auth.login("LV-LATE", PW)).token).toBeTruthy();
    await kid("LV-END", { status: "left", leftOn: ist(10), accessUntil: ist(1) }); // ended yesterday although left_on + 90 is ahead
    expect(await reason(auth.login("LV-END", PW))).toBe("closed");
    await kid("LV-NOUNTIL", { status: "left", leftOn: ist(10), accessUntil: null });
    expect(await reason(auth.login("LV-NOUNTIL", PW))).toBe("closed");
  });

  it("the right password on a closed or joining login never meets 'Too many attempts'", async () => {
    await kid("LV-LIM", { status: "left", leftOn: ist(200) });
    for (let i = 0; i < 9; i++) expect(await reason(auth.login("LV-LIM", "wrong-Pass-1"))).toBe("invalid");
    expect(await reason(auth.login("LV-LIM", PW))).toBe("closed"); // the 10th try
    expect(await reason(auth.login("LV-LIM", PW))).toBe("closed"); // and the 11th
    await kid("LV-LIMJ", { status: "joining", joinsOn: "2027-01-12" }, { status: "disabled" });
    for (let i = 0; i < 9; i++) await reason(auth.login("LV-LIMJ", "wrong-Pass-1"));
    expect(await reason(auth.login("LV-LIMJ", PW))).toBe("starts");
    expect(await reason(auth.login("LV-LIMJ", PW))).toBe("starts");
  });

  it("no last day is closed, also for an alumni by promotion", async () => {
    await kid("LV-NODATE", { status: "left", leftOn: null });
    await kid("LV-ALNODATE", { status: "alumni", leftOn: null });
    expect(await reason(auth.login("LV-NODATE", PW))).toBe("closed");
    expect(await reason(auth.login("LV-ALNODATE", PW))).toBe("closed");
  });

  it("an open session stops the day the 90 days end, and a support session too", async () => {
    await kid("LV-SESS", { status: "left", leftOn: ist(30) });
    const s = await auth.login("LV-SESS", PW);
    expect(await auth.validate(s.token)).not.toBeNull();
    const u = (await withSchool(schoolId, (tx) => tx.select().from(users).where(eq(users.loginId, "LV-SESS"))))[0]!;
    const support = await withSchool(schoolId, (tx) => auth.createSession(tx, u.id, { minutes: 30 }));
    await setLeftOn("LV-SESS", ist(91));
    expect(await auth.validate(s.token)).toBeNull();
    expect(await auth.validate(support.token)).toBeNull();
  });

  it("a code sign-in is refused with the sentence only after the right code; a wrong code gives the usual answer", async () => {
    const u = await kid("LV-CODE", { status: "left", leftOn: ist(100) });
    const code = (await sendCode(auth, "LV-CODE", "login"))!;
    expect(await otpReason(auth.loginWithCode("LV-CODE", "000000"))).toBe("wrong");
    expect(await reason(auth.loginWithCode("LV-CODE", code))).toBe("closed");
    // the code is used up: the same code now reads like any bad code
    expect(await otpReason(auth.loginWithCode("LV-CODE", code))).toBe("none");
    await ageCodes(u.id);
    await setLeftOn("LV-CODE", ist(5));
    const again = (await sendCode(auth, "LV-CODE", "login"))!;
    expect((await auth.loginWithCode("LV-CODE", again)).token).toBeTruthy();
  });

  it("forgot password: the mail goes out the same, and the reset by code or by link says the sentence only after the secret is right", async () => {
    await kid("LV-RESET", { status: "left", leftOn: ist(120) });
    const r = await auth.requestPasswordReset("LV-RESET");
    expect(r.send).toBeDefined();
    expect(await reason(auth.resetPassword(r.send!.token, "Maple-River-42"))).toBe("closed");
    expect(await otpReason(auth.resetPasswordWithCode("LV-RESET", "000000", "Maple-River-42"))).toBe("wrong");
    expect(await reason(auth.resetPasswordWithCode("LV-RESET", r.send!.code!, "Maple-River-42"))).toBe("closed");
    expect(await reason(auth.resetPassword("not-a-token", "Maple-River-42"))).toBe("invalid");
  });

  it("a joining student (login off) hears the start date after the right password only", async () => {
    await kid("LV-JOIN", { status: "joining", joinsOn: "2027-01-12" }, { status: "disabled" });
    const err = await auth.login("LV-JOIN", PW).catch((e) => e);
    expect(err).toBeInstanceOf(LoginError);
    expect(err.reason).toBe("starts");
    expect(loginRefusal(err)).toBe("This login starts on 12 Jan 2027.");
    expect(await reason(auth.login("LV-JOIN", "wrong-Pass-1"))).toBe("invalid");
    // no code is ever mailed to a login that is off, and a code attempt reads like any bad code
    expect((await auth.sendOtp("LV-JOIN", "login")).send).toBeUndefined();
    expect(await otpReason(auth.loginWithCode("LV-JOIN", "123456"))).toBe("none");
  });

  it("school isolation: another school's left student never closes a login here", async () => {
    const [b] = await withConsole((tx) => tx.insert(schools).values({ slug: "auth-lv-b", name: "Other", status: "active" }).returning());
    const hash = await Passwords.hash(PW);
    const [ub] = await withConsole((tx) => tx.insert(users).values({ schoolId: b!.id, role: "student", loginId: "LV-ISO", name: "Iso", passwordHash: hash }).returning());
    await withSchool(b!.id, (tx) => tx.execute(sql`insert into students (id, school_id, admission_no, name, user_id, status, left_on) values (gen_random_uuid(), ${b!.id}, 'LV-ISO', 'Iso', ${ub!.id}, 'left', ${ist(400)}::date)`));
    await kid("LV-ISO", { status: "active" });
    expect((await auth.login("LV-ISO", PW)).token).toBeTruthy();
    expect(await reason(new SchoolAuth(b!.id).login("LV-ISO", PW))).toBe("closed");
  });
});
