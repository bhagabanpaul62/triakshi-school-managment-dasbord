// Deleting a left student's optional data, from a deletion request: everything that holds their contact goes, the record stays, and asking twice is safe.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, sql, users, uuidv7, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { PrivacyService } from "@smw/feature-settings/privacy-service";
import { UserAdminService } from "@smw/feature-settings/service";
import { StudentService } from "@smw/feature-students/service";
import { EnquiryService } from "@smw/feature-website/service";
import { admitFromEnquiry } from "./admit-flow";
import { eraseStudentForRequest } from "./erase-student";

const FEATURES = ["academics", "students", "website", "announcements", "events", "notifications", "settings"];
let a: TestSchool, b: TestSchool;
beforeAll(async () => { useServices({ storage: new MemoryStorage() }); ({ a, b } = await createSchoolPair(FEATURES, "ers")); });
afterAll(closeDb);

const reason = "Parent asked for deletion in writing";
async function leftStudent(name: string) {
  const enq = await new EnquiryService(a.as.admin).create({ studentName: name, parentName: "Mrs Parent", phone: "9876500001", email: "parent@example.test", address: "5 Hill Road", source: "walk-in" });
  const out = await admitFromEnquiry(a.as.admin, enq.id, undefined, { name });
  const svc = new StudentService(a.as.admin);
  await svc.update(out.studentId, { phone: "9811100099", address: "5 Hill Road" });
  const s = await svc.get(out.studentId);
  await withSchool(a.id, async (tx) => {
    await tx.update(users).set({ email: `child-${s.id}@example.test`, phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` }).where(eq(users.id, s.userId!));
    await tx.execute(sql`insert into push_subscriptions (id, school_id, user_id, endpoint, p256dh, auth) values (${uuidv7()}, ${a.id}, ${s.userId}, ${`https://push.test/${s.id}`}, 'k', 'a')`);
    await tx.execute(sql`insert into calendar_feeds (id, school_id, user_id, token_hash) values (${uuidv7()}, ${a.id}, ${s.userId}, ${`feed-${s.id}`})`);
  });
  await svc.update(s.id, { status: "left" });
  const request = await new PrivacyService(a.as.admin).create({ kind: "erasure", details: "Please delete my child's data", subjectType: "student", subjectId: s.id, subjectName: name, raisedByName: "Mrs Parent" });
  return { s, enq: enq.id, request };
}

describe("erasing from a deletion request", () => {
  it("removes every trace of contact: login, push and calendar links, enquiry, and phone numbers written in old audit entries", async () => {
    const { s, enq, request } = await leftStudent("Erase Me");
    const preview = await new StudentService(a.as.admin).erasePreview(s.id);
    const labels = preview.blank.map((b) => b.label).join("|");
    for (const part of ["Student login", "push and calendar", "Website enquiry contact details (1 enquiry)", "audit log"]) expect(labels).toContain(part);

    const out = await eraseStudentForRequest(a.as.admin, { studentId: s.id, requestId: request.id, confirm: s.admissionNo, reason });
    expect(out.already).toBe(false);

    const login = (await withSchool(a.id, (tx) => tx.select().from(users).where(eq(users.id, s.userId!))))[0]!;
    expect(login).toMatchObject({ status: "disabled", email: null, phone: null, passwordHash: null });
    expect(login.loginId).toBe(`erased-${s.userId}`);
    const left = await withSchool(a.id, (tx) => tx.execute<{ n: number }>(sql`select (select count(*) from push_subscriptions where user_id = ${s.userId})::int + (select count(*) from calendar_feeds where user_id = ${s.userId})::int as n`));
    expect(left[0]!.n).toBe(0);
    const [e] = await withSchool(a.id, (tx) => tx.execute<Record<string, unknown>>(sql`select parent_name, phone, email, address, student_name from enquiries where id = ${enq}`));
    expect(e).toMatchObject({ parent_name: "(erased)", phone: "", email: null, address: null, student_name: "Erase Me" });

    const entries = await withSchool(a.id, (tx) => tx.execute<{ action: string; summary: string; meta: { changes?: Record<string, unknown[]>; auditEntriesScrubbed?: number } }>(sql`select action, summary, meta from audit_logs where entity_id = ${s.id} order by created_at`));
    const edit = entries.find((x) => x.action === "update" && x.meta.changes?.phone)!;
    expect(edit.meta.changes!.phone).toEqual(["(erased)", "(erased)"]);
    expect(edit.summary).toContain("Erase Me");
    const erased = entries.find((x) => x.action === "erase")!;
    expect(erased.meta.auditEntriesScrubbed).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain("9811100099");
    expect((await new PrivacyService(a.as.admin).get(request.id)).state).toBe("done");

    // Kept: the name, admission number and the record itself.
    expect(await new StudentService(a.as.admin).get(s.id)).toMatchObject({ name: "Erase Me", admissionNo: s.admissionNo, phone: null });
  });

  it("an erased login cannot be switched back on", async () => {
    const { s, request } = await leftStudent("No Return");
    await eraseStudentForRequest(a.as.admin, { studentId: s.id, requestId: request.id, confirm: s.admissionNo, reason });
    await expect(new UserAdminService(a.as.admin).enable(s.userId!)).rejects.toThrow(/erased/);
  });

  it("asking again is safe: no second closing, no error; a closed request or wrong confirmation erases nothing", async () => {
    const { s, request } = await leftStudent("Twice Over");
    await expect(eraseStudentForRequest(a.as.admin, { studentId: s.id, requestId: request.id, confirm: "WRONG", reason })).rejects.toBeInstanceOf(ValidationError);
    expect((await new StudentService(a.as.admin).get(s.id)).phone).toBe("9811100099");
    await eraseStudentForRequest(a.as.admin, { studentId: s.id, requestId: request.id, confirm: s.admissionNo, reason });
    const steps = (await new PrivacyService(a.as.admin).get(request.id)).steps.length;
    await expect(eraseStudentForRequest(a.as.admin, { studentId: s.id, requestId: request.id, confirm: s.admissionNo, reason })).resolves.toMatchObject({ already: true });
    expect((await new PrivacyService(a.as.admin).get(request.id)).steps).toHaveLength(steps);

    const other = await leftStudent("Refused One");
    await new PrivacyService(a.as.admin).close(other.request.id, { state: "refused", outcome: "The law says the school must keep this" });
    await expect(eraseStudentForRequest(a.as.admin, { studentId: other.s.id, requestId: other.request.id, confirm: other.s.admissionNo, reason })).rejects.toBeInstanceOf(ConflictError);
    expect((await new StudentService(a.as.admin).get(other.s.id)).phone).toBe("9811100099");
    // A request about someone else's student cannot be used to erase this one.
    await expect(eraseStudentForRequest(a.as.admin, { studentId: other.s.id, requestId: request.id, confirm: other.s.admissionNo, reason })).rejects.toBeInstanceOf(ValidationError);
  });

  it("the finishing step is idempotent on its own, never in a support session, and isolated to its school", async () => {
    const { s, request } = await leftStudent("Finish Twice");
    const privacy = new PrivacyService(a.as.admin);
    await new StudentService(a.as.admin).eraseOptional(s.id, reason);
    await privacy.finishErasure(request.id, "Blanked: phone");
    await expect(privacy.finishErasure(request.id, "Blanked: phone")).resolves.toMatchObject({ state: "done" });
    const support = { ...a.as.admin, supportStaffId: uuidv7() };
    await expect(new StudentService(support).eraseOptional(s.id, reason)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StudentService(support).erasePreview(s.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(eraseStudentForRequest(b.as.admin, { studentId: s.id, requestId: request.id, confirm: s.admissionNo, reason })).rejects.toThrow();
  });
});
