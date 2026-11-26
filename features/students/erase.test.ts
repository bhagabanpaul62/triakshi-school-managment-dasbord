import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, sessions, sql, users, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createTestSchool, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import academicsFeature from "@smw/feature-academics/feature";
import studentsFeature from "./feature";
import { GuardianService, LifecycleService, StudentService } from "./service";
import { guardians, students } from "./schema";

const storage = new MemoryStorage();
let a: TestSchool, b: TestSchool;
beforeAll(async () => {
  useServices({ storage });
  await registerFeatures([academicsFeature, studentsFeature]);
  a = await createTestSchool("erasea", ["academics", "students"]);
  b = await createTestSchool("eraseb", ["academics", "students"]);
});
afterAll(closeDb);

const svc = () => new StudentService(a.as.admin);
const row = (id: string) => withSchool(a.id, async (tx) => (await tx.select().from(students).where(eq(students.id, id)))[0]!);

async function leaver(name: string, extra: Record<string, unknown> = {}) {
  const s = await svc().create({ name, phone: "9811100010", address: "12 Lake Road", medicalNotes: "Asthma", emergencyName: "Aunt", emergencyPhone: "9811100011", bloodGroup: "B+", apaarId: "A12345", ...extra });
  await withSchool(a.id, (tx) => tx.execute(sql`update students set photo_key = ${`${a.id}/avatars/${s.id}.png`} where id = ${s.id}`));
  await storage.put(`${a.id}/avatars/${s.id}.png`, new Uint8Array([1]), "image/png");
  await new LifecycleService(a.as.admin).markLeft(s.id, { reason: "changed_school" });
  return s;
}

describe("erasing the optional data of a student who left", () => {
  it("refuses an active student, with the way forward in the words", async () => {
    const s = await svc().create({ name: "Still Here", phone: "9811100012" });
    await expect(svc().eraseOptional(s.id, "Parent asked for deletion")).rejects.toBeInstanceOf(ConflictError);
    expect((await svc().erasePreview(s.id)).refusal).toMatch(/Mark the student as left/);
    expect((await row(s.id)).phone).toBe("9811100012");
  });

  it("previews what goes and what stays, then blanks contact, address, photo, medical and the login; keeps name, number and the record", async () => {
    const s = await leaver("Left Kid", { guardianName: "Only Parent", guardianPhone: "9811100020", guardianRelation: "mother" });
    const loginId = (await row(s.id)).userId!;
    await withSchool(a.id, (tx) => tx.insert(sessions).values({ userId: loginId, schoolId: a.id, tokenHash: `erase-${s.id}`, expiresAt: new Date(Date.now() + 1e6) }));
    expect(await withSchool(a.id, (tx) => tx.select().from(sessions).where(eq(sessions.userId, loginId)))).toHaveLength(1);
    const preview = await svc().erasePreview(s.id);
    expect(preview).toMatchObject({ name: "Left Kid", refusal: null });
    expect(preview.blank.find((b) => b.label === "Medical notes")!.filled).toBe(true);
    expect(preview.guardians).toEqual([{ name: "Only Parent", blanked: true, why: expect.stringContaining("No other child") }]);
    expect(preview.keep.join(" ")).toMatch(/marks/);

    await expect(svc().eraseOptional(s.id, "short")).rejects.toBeInstanceOf(ValidationError);
    const done = await svc().eraseOptional(s.id, "Parent asked for deletion in writing");
    expect(done.guardians).toBe(1);
    const after = await row(s.id);
    expect(after).toMatchObject({ name: "Left Kid", admissionNo: s.admissionNo, status: "left", phone: null, altPhone: null, address: null, photoKey: null, medicalNotes: null, emergencyName: null, emergencyPhone: null, bloodGroup: null, apaarId: null });
    expect(storage.files.has(`${a.id}/avatars/${s.id}.png`)).toBe(false);
    const login = (await withSchool(a.id, (tx) => tx.select().from(users).where(eq(users.id, loginId))))[0]!;
    expect(login).toMatchObject({ status: "disabled", email: null, phone: null, loginId: `erased-${loginId}` });
    expect(await withSchool(a.id, (tx) => tx.select().from(sessions).where(eq(sessions.userId, loginId)))).toEqual([]);
    const [g] = await new GuardianService(a.as.admin).forStudent(s.id);
    expect(g).toMatchObject({ name: "Only Parent", phone: null, email: null });
    const logged = await withSchool(a.id, (tx) => tx.execute<{ meta: { reason: string; blanked: string[] } }>(sql`select meta from audit_logs where action = 'erase' and entity_id = ${s.id}`));
    expect(logged[0]!.meta).toMatchObject({ reason: "Parent asked for deletion in writing", blanked: expect.arrayContaining(["address", "medical notes"]) });
    // The same story on the second try: nothing left to blank, still allowed and still logged.
    await expect(svc().eraseOptional(s.id, "Second pass for the record")).resolves.toBeTruthy();
  });

  it("keeps a guardian's contact while another child of theirs is still active", async () => {
    const kept = await svc().create({ name: "Younger Sibling", guardianName: "Shared Parent", guardianPhone: "9811100030", guardianRelation: "father" });
    const old = await svc().create({ name: "Older Sibling", guardianName: "Shared Parent", guardianPhone: "9811100030", guardianRelation: "father" });
    await new LifecycleService(a.as.admin).markLeft(old.id, { reason: "changed_school" });
    const preview = await svc().erasePreview(old.id);
    expect(preview.guardians).toEqual([expect.objectContaining({ name: "Shared Parent", blanked: false })]);
    expect((await svc().eraseOptional(old.id, "Parent asked for deletion in writing")).guardians).toBe(0);
    const [g] = await new GuardianService(a.as.admin).forStudent(kept.id);
    expect(g!.phone).toBe("9811100030");
    expect((await withSchool(a.id, (tx) => tx.select().from(guardians).where(eq(guardians.id, g!.id))))[0]!.phone).toBe("9811100030");
  });

  it("only an admin may, and school B cannot reach A's student", async () => {
    const s = await leaver("Guarded Kid");
    await expect(new StudentService(a.as.teacher).eraseOptional(s.id, "Parent asked for deletion in writing")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StudentService(a.as.accountant).erasePreview(s.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new StudentService(b.as.admin).eraseOptional(s.id, "Parent asked for deletion in writing")).rejects.toBeInstanceOf(NotFoundError);
    await expect(new StudentService({ ...a.as.admin, readOnly: true }).eraseOptional(s.id, "Parent asked for deletion in writing")).rejects.toThrow(/read-only/);
    expect((await row(s.id)).phone).toBe("9811100010");
  });
});

describe("the audit log of a student edit", () => {
  it("records old and new for ordinary fields, and only 'changed' for medical, health and personal ones", async () => {
    const s = await svc().create({ name: "Audited Kid", phone: "9811100040", medicalNotes: "Asthma", religion: "X", category: "General", bloodGroup: "A+" });
    await svc().update(s.id, { phone: "9811100041", medicalNotes: "Peanut allergy", religion: "Y", category: "OBC", bloodGroup: "B+", address: "New address" });
    const [entry] = await withSchool(a.id, (tx) => tx.execute<{ meta: { changes: Record<string, [unknown, unknown]> } }>(sql`select meta from audit_logs where entity_id = ${s.id} and action = 'update'`));
    const c = entry!.meta.changes;
    expect(c.phone).toEqual(["9811100040", "9811100041"]);
    expect(c.address).toEqual([null, "New address"]);
    for (const hidden of ["medicalNotes", "religion", "category", "bloodGroup"]) expect(c[hidden]).toEqual(["(hidden)", "(hidden)"]);
    expect(JSON.stringify(entry)).not.toMatch(/Peanut|Asthma|OBC/);
  });
});
