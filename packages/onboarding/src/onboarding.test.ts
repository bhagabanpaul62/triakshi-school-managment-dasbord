import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SchoolAuth } from "@smw/auth";
import { eq, plans, platformStaff, schoolDomains, schools, users, withConsole, withSchool } from "@smw/db";
import { MemoryEmailSender, useServices } from "@smw/integrations";
import { ConflictError, createSchool, PlanCatalog, SignupService, signupLimiter, resendLimiter, ValidationError } from "./index";

const base = { name: "Sunrise Public School", adminName: "Asha Rao", email: "Asha@Sunrise.test", phone: "+91 98765 43210", state: "Karnataka", city: "Mysuru", board: "CBSE", approxStudents: 450 } as const;
const mail = new MemoryEmailSender();

beforeAll(async () => {
  useServices({ email: mail });
  await withConsole((tx) => tx.insert(plans).values([
    { key: "starter", name: "Starter", studentCap: 300, priceAnnualPaise: 3_000_000, priceMonthlyPaise: 300_000, sortOrder: 1 },
    { key: "growth", name: "Growth", studentCap: 1000, priceAnnualPaise: 7_500_000, priceMonthlyPaise: 750_000, sortOrder: 2 },
    { key: "growth", name: "Growth old", version: 0, studentCap: 1000, priceAnnualPaise: 1, priceMonthlyPaise: 1, sortOrder: 2 },
    { key: "enterprise", name: "Enterprise", studentCap: 100000, priceAnnualPaise: 0, priceMonthlyPaise: 0, sortOrder: 9, isPublic: false },
  ]));
});
beforeEach(() => { mail.sent.length = 0; signupLimiter.reset("signup:1.1.1.1"); });

describe("PlanCatalog", () => {
  it("lists newest public plans and picks by student count", async () => {
    const list = await PlanCatalog.publicPlans();
    expect(list.map((p) => p.name)).toEqual(["Starter", "Growth"]);
    expect(PlanCatalog.pick(list, 100)?.key).toBe("starter");
    expect(PlanCatalog.pick(list, 450)?.key).toBe("growth");
    expect(PlanCatalog.pick(list, 5000)?.key).toBe("growth");
    expect(PlanCatalog.pick([], 5)).toBeNull();
  });
});

describe("createSchool", () => {
  it("creates exactly one school, one verified subdomain and one invited admin", async () => {
    const r = await createSchool({ ...base, slug: "sunrise" });
    const [s] = await withConsole((tx) => tx.select().from(schools).where(eq(schools.slug, "sunrise")));
    expect(s).toMatchObject({ id: r.schoolId, status: "trial", studentCap: 1000, phone: "9876543210", board: "CBSE" });
    expect(s!.planId).not.toBeNull();
    expect(s!.trialEndsAt!.getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    const doms = await withConsole((tx) => tx.select().from(schoolDomains).where(eq(schoolDomains.schoolId, r.schoolId)));
    expect(doms).toHaveLength(1);
    expect(doms[0]).toMatchObject({ hostname: r.hostname, kind: "subdomain", status: "verified" });
    const us = await withConsole((tx) => tx.select().from(users).where(eq(users.schoolId, r.schoolId)));
    expect(us).toHaveLength(1);
    expect(us[0]).toMatchObject({ role: "admin", status: "invited", loginId: "asha@sunrise.test", passwordHash: null });
  });

  it("a pending school has no trial clock and no module access yet", async () => {
    const r = await createSchool({ ...base, email: "p@pend.test", slug: "pendingone", status: "pending" });
    const [s] = await withConsole((tx) => tx.select().from(schools).where(eq(schools.id, r.schoolId)));
    expect(s).toMatchObject({ status: "pending", trialEndsAt: null });
  });

  it("a duplicate slug is a ConflictError and leaves nothing behind", async () => {
    await expect(createSchool({ ...base, email: "b@other.test", slug: "sunrise" })).rejects.toBeInstanceOf(ConflictError);
    const us = await withConsole((tx) => tx.select().from(users).where(eq(users.email, "b@other.test")));
    expect(us).toHaveLength(0);
  });

  it("rejects a bad slug", async () => {
    await expect(createSchool({ ...base, slug: "admin" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("SignupService", () => {
  it("checkSlug reports taken, reserved and free", async () => {
    expect(await SignupService.checkSlug("sunrise")).toMatchObject({ available: false, suggestion: "sunrise-2" });
    expect(await SignupService.checkSlug("console")).toMatchObject({ available: false });
    expect(await SignupService.checkSlug("moonrise")).toEqual({ available: true });
  });

  it("start creates a pending school and emails a single-use verify link", async () => {
    const r = await SignupService.start({ ...base, email: "meera@moon.test", slug: "moonrise" }, { ip: "1.1.1.1" });
    const [row] = await withConsole((tx) => tx.select().from(schools).where(eq(schools.id, r.schoolId)));
    expect(row).toMatchObject({ status: "pending", trialEndsAt: null });
    expect(r.emailSent).toBe(true);
    expect(mail.sent).toHaveLength(1);
    const m = mail.sent[0]!;
    expect(m.to).toBe("meera@moon.test");
    const token = new URL(m.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
    expect(m.text).toContain("moonrise.localhost");
    expect(m.text).toContain("reviews your school");
    const auth = new SchoolAuth(r.schoolId);
    const first = await withSchool(r.schoolId, (tx) => auth.consumeToken(tx, "verify_email", token));
    expect(first?.userId).toBe(r.adminUserId);
    const second = await withSchool(r.schoolId, (tx) => auth.consumeToken(tx, "verify_email", token));
    expect(second).toBeNull();
  });

  it("a taken address is a field error and sends no email", async () => {
    await expect(SignupService.start({ ...base, email: "fresh@moon.test", slug: "moonrise" }, { ip: "1.1.1.1" })).rejects.toMatchObject({ fieldErrors: { slug: expect.any(String) } });
    expect(mail.sent).toHaveLength(0);
  });

  it("an email that already signs in to a school starts no new school: its owner is emailed the way in", async () => {
    const before = (await withConsole((tx) => tx.select().from(schools))).length;
    // Asha administers "sunrise" (from createSchool above) and has no password yet: the mail offers to set one.
    await expect(SignupService.start({ ...base, email: " ASHA@sunrise.test ", slug: "second-school" }, { ip: "1.1.1.1" }))
      .rejects.toMatchObject({ fieldErrors: { email: expect.stringMatching(/already has a Triakshi account/) } });
    expect((await withConsole((tx) => tx.select().from(schools))).length).toBe(before);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: "asha@sunrise.test", subject: expect.stringContaining("Sunrise Public School") });
    expect(mail.sent[0]!.text).toMatch(/sunrise\.localhost\S*\/reset-password\?token=/);

    // With a password set, the mail points at sign-in with the email filled in instead.
    await withConsole((tx) => tx.update(users).set({ passwordHash: "x" }).where(eq(users.email, "asha@sunrise.test")));
    mail.sent.length = 0;
    await expect(SignupService.start({ ...base, slug: "third-school" }, { ip: "1.1.1.1" })).rejects.toBeInstanceOf(ValidationError);
    expect(mail.sent[0]!.text).toContain("/login?id=asha%40sunrise.test");
  });

  it("a Triakshi team email cannot register a school", async () => {
    await withConsole((tx) => tx.insert(platformStaff).values({ email: "Owner@Triakshi.test", name: "Owner", role: "owner", passwordHash: "x" }));
    await expect(SignupService.start({ ...base, email: "owner@triakshi.test", slug: "team-school" }, { ip: "1.1.1.1" }))
      .rejects.toMatchObject({ fieldErrors: { email: expect.stringMatching(/team login/) } });
    expect(mail.sent).toHaveLength(0);
  });

  it("validates phone and email", async () => {
    await expect(SignupService.start({ ...base, phone: "12345", email: "nope", slug: "freshone" })).rejects.toMatchObject({ fieldErrors: { phone: expect.any(String), email: expect.any(String) } });
  });

  it("resend sends a new link only for an admin who has not set a password, and answers the same either way", async () => {
    const r = await SignupService.start({ ...base, email: "neel@resend.test", slug: "resendone" }, { ip: "1.1.1.1" });
    mail.sent.length = 0;
    resendLimiter.reset(`resend:${r.schoolId}`);
    expect(await SignupService.resendVerification(r.schoolId, "someone@else.test")).toEqual({ limited: false });
    expect(mail.sent).toHaveLength(0);
    expect(await SignupService.resendVerification(r.schoolId, " Neel@Resend.test ")).toEqual({ limited: false });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.text).toContain("resendone.localhost");
    await withConsole((tx) => tx.update(users).set({ status: "active" }).where(eq(users.id, r.adminUserId)));
    expect(await SignupService.resendVerification(r.schoolId, "neel@resend.test")).toEqual({ limited: false });
    expect(mail.sent).toHaveLength(1);
    for (let i = 0; i < 3; i++) await SignupService.resendVerification(r.schoolId, "neel@resend.test");
    expect(await SignupService.resendVerification(r.schoolId, "neel@resend.test")).toEqual({ limited: true });
  });

  it("rate-limits per IP", async () => {
    for (let i = 0; i < 5; i++) await SignupService.start({ ...base, phone: "abc", slug: "x" }, { ip: "1.1.1.1" }).catch(() => {});
    await expect(SignupService.start({ ...base, slug: "ratelimited" }, { ip: "1.1.1.1" })).rejects.toMatchObject({ code: "rate_limited" });
  });
});

