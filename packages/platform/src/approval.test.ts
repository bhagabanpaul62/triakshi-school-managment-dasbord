import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, platformAuditLogs, schools, withConsole } from "@smw/db";
import { ConflictError, ForbiddenError, ValidationError, type StaffCtx } from "@smw/feature-kit";
import { MemoryEmailSender, useServices as setServices } from "@smw/integrations";
import { createSchool } from "@smw/onboarding";
import { ApprovalService, SchoolAdminService } from "./index";

vi.setConfig({ testTimeout: 90_000 });
afterAll(closeDb);

const mail = new MemoryEmailSender();
setServices({ email: mail });
beforeEach(() => { mail.sent.length = 0; });

const staff = (role: StaffCtx["role"] = "owner"): StaffCtx => ({ staffId: crypto.randomUUID(), role, name: `Test ${role}` });
const owner = staff("owner");
let n = 0;
const pending = async () => {
  const slug = `appr${Date.now().toString(36)}${n++}`;
  const r = await createSchool({ name: "Approval Test School", slug, adminName: "Anita Rao", email: `anita${n}@appr.test`, status: "pending" });
  return { ...r, email: `anita${n}@appr.test` };
};
const logged = (action: string, schoolId: string) =>
  withConsole((tx) => tx.select().from(platformAuditLogs).where(and(eq(platformAuditLogs.action, action), eq(platformAuditLogs.schoolId, schoolId))));
const row = async (id: string) => (await withConsole((tx) => tx.select().from(schools).where(eq(schools.id, id))))[0]!;

describe("ApprovalService", () => {
  it("lists a pending school with its admin and whether the email is verified", async () => {
    const p = await pending();
    const list = await new ApprovalService(staff("support")).listPending();
    const found = list.find((x) => x.id === p.schoolId)!;
    expect(found).toMatchObject({ adminName: "Anita Rao", adminEmail: p.email, emailVerified: false, status: "pending" });
    expect((await new ApprovalService(owner).pendingCount())).toBeGreaterThan(0);
  });

  it("approve starts a 30-day trial now, audits it and emails the sign-in link", async () => {
    const p = await pending();
    expect((await row(p.schoolId)).trialEndsAt).toBeNull();
    const r = await new ApprovalService(owner).approve(p.schoolId, "Looks real");
    expect(r).toMatchObject({ status: "trial", emailSent: true });
    const s = await row(p.schoolId);
    expect(s.status).toBe("trial");
    expect(Math.round((s.trialEndsAt!.getTime() - Date.now()) / 86_400_000)).toBe(30);
    expect(await logged("school.approve", p.schoolId)).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: p.email });
    expect(mail.sent[0]!.text).toContain(`${p.slug}.`);
    expect(mail.sent[0]!.text).toContain("/login");
  });

  it("only pending schools can be approved, and only once", async () => {
    const p = await pending();
    const svc = new ApprovalService(owner);
    await svc.approve(p.schoolId);
    await expect(svc.approve(p.schoolId)).rejects.toBeInstanceOf(ConflictError);
    expect(mail.sent).toHaveLength(1);
  });

  it("support and sales cannot approve or reject", async () => {
    const p = await pending();
    for (const role of ["support", "sales"] as const) {
      await expect(new ApprovalService(staff(role)).approve(p.schoolId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new ApprovalService(staff(role)).reject(p.schoolId, "Not a school")).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await row(p.schoolId)).status).toBe("pending");
  });

  it("reject needs a reason, emails it with a reply-to, and reopen sends it back to the queue", async () => {
    const p = await pending();
    const svc = new ApprovalService(owner);
    await expect(svc.reject(p.schoolId, "no")).rejects.toBeInstanceOf(ValidationError);
    await svc.reject(p.schoolId, "We could not find this school in UDISE.");
    expect((await row(p.schoolId)).status).toBe("rejected");
    expect(mail.sent[0]!.text).toContain("UDISE");
    expect(mail.sent[0]!.replyTo).toContain("support@");
    expect((await svc.review(p.schoolId)).rejectedReason).toContain("UDISE");
    await expect(svc.approve(p.schoolId)).rejects.toBeInstanceOf(ConflictError);
    await svc.reopen(p.schoolId);
    expect((await row(p.schoolId)).status).toBe("pending");
    await expect(svc.reopen(p.schoolId)).rejects.toBeInstanceOf(ConflictError);
    expect(await logged("school.reject", p.schoolId)).toHaveLength(1);
    expect(await logged("school.reopen", p.schoolId)).toHaveLength(1);
  });

  it("a failing mail server does not undo the approval", async () => {
    const p = await pending();
    setServices({ email: { send: async () => { throw new Error("smtp down"); } } });
    try {
      const r = await new ApprovalService(owner).approve(p.schoolId);
      expect(r).toMatchObject({ status: "trial", emailSent: false });
    } finally { setServices({ email: mail }); }
  });

  it("other lifecycle actions cannot skip the review", async () => {
    const p = await pending();
    await expect(new SchoolAdminService(owner).reactivate(p.schoolId)).rejects.toBeInstanceOf(ConflictError);
    await expect(new SchoolAdminService(owner).suspend(p.schoolId)).rejects.toBeInstanceOf(ConflictError);
  });
});
