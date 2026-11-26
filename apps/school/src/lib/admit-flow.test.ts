// The office admits a child from an enquiry in two steps. The student must never be made twice, and the student's record must say where they came from.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { StudentService } from "@smw/feature-students/service";
import { cameFromEnquiry } from "@smw/feature-students/came-from";
import { EnquiryService } from "@smw/feature-website/service";
import { admitFromEnquiry } from "./admit-flow";

const FEATURES = ["academics", "students", "website", "announcements", "events", "notifications"];
let a: TestSchool, b: TestSchool;
beforeAll(async () => { useServices({ storage: new MemoryStorage() }); ({ a, b } = await createSchoolPair(FEATURES, "adm")); });
afterAll(closeDb);

const newEnquiry = async (name: string) => {
  const e = await new EnquiryService(a.as.admin).create({ studentName: name, parentName: "Parent", phone: "9876512345", source: "walk-in" });
  return e.id;
};
const countStudents = async (name: string) => (await withSchool(a.id, async () => new StudentService(a.as.admin).list({ q: name }))).total;

describe("admit from an enquiry", () => {
  it("makes the student, marks and links the enquiry, and the student's record shows where they came from", async () => {
    const id = await newEnquiry("Aarav Single");
    const out = await admitFromEnquiry(a.as.admin, id, undefined, { name: "Aarav Single" });
    expect(out.marked).toBe(true);
    const e = await new EnquiryService(a.as.admin).get(id);
    expect(e).toMatchObject({ status: "admitted", convertedStudentId: out.studentId });
    const came = await cameFromEnquiry(a.as.admin, out.studentId);
    expect(came).toMatchObject({ id, ref: e.ref });
    // Visible to those who read enquiries, not to a teacher, not in another school, not for a student with no enquiry.
    expect(await cameFromEnquiry(a.as.accountant, out.studentId)).not.toBeNull();
    expect(await cameFromEnquiry(a.as.teacher, out.studentId)).toBeNull();
    expect(await cameFromEnquiry({ ...a.as.admin, grants: new Set(["students:read"]) }, out.studentId)).toBeNull();
    expect(await cameFromEnquiry(b.as.admin, out.studentId)).toBeNull();
    const plain = (await new StudentService(a.as.admin).admit({ name: "Walk In Child" })).student;
    expect(await cameFromEnquiry(a.as.admin, plain.id)).toBeNull();
  });

  it("when marking fails the student exists once; the retry with its id marks, and does not make another", async () => {
    const id = await newEnquiry("Bina Retry");
    const spy = vi.spyOn(EnquiryService.prototype, "markAdmitted").mockRejectedValueOnce(new ConflictError("Could not mark"));
    const first = await admitFromEnquiry(a.as.admin, id, undefined, { name: "Bina Retry" });
    spy.mockRestore();
    expect(first).toMatchObject({ marked: false, message: "Could not mark" });
    expect(await countStudents("Bina Retry")).toBe(1);
    // A second press without the id finds the student the claim already names: linked, and no second student.
    const again = await admitFromEnquiry(a.as.admin, id, undefined, { name: "Bina Retry" });
    expect(again).toMatchObject({ marked: true, studentId: first.studentId });
    expect(await countStudents("Bina Retry")).toBe(1);
    const retry = await admitFromEnquiry(a.as.admin, id, first.studentId, {});
    expect(retry.marked).toBe(true);
    expect(await countStudents("Bina Retry")).toBe(1);
    expect((await new EnquiryService(a.as.admin).get(id)).convertedStudentId).toBe(first.studentId);
    // Marking again is safe, and a finished enquiry refuses a new admission.
    expect((await admitFromEnquiry(a.as.admin, id, first.studentId, {})).marked).toBe(true);
    await expect(admitFromEnquiry(a.as.admin, id, undefined, { name: "Bina Retry" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("a double submit at the same moment makes one student", async () => {
    const id = await newEnquiry("Chitra Twice");
    const r = await Promise.allSettled([
      admitFromEnquiry(a.as.admin, id, undefined, { name: "Chitra Twice" }),
      admitFromEnquiry(a.as.admin, id, undefined, { name: "Chitra Twice" }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(await countStudents("Chitra Twice")).toBe(1);
  });

  it("a student that could not be made lets the next try through at once", async () => {
    const id = await newEnquiry("Dev Fails");
    await expect(admitFromEnquiry(a.as.admin, id, undefined, { name: "" })).rejects.toBeDefined();
    const ok = await admitFromEnquiry(a.as.admin, id, undefined, { name: "Dev Fails" });
    expect(ok.marked).toBe(true);
  });

  it("a child already in the school is refused with their record, the claim is released, and ticking different child admits", async () => {
    await new StudentService(a.as.admin).create({ name: "Esha Same", dob: "2015-05-05" });
    const id = await newEnquiry("Esha Same");
    await expect(admitFromEnquiry(a.as.admin, id, undefined, { name: "Esha Same", dob: "2015-05-05" })).rejects.toMatchObject({ fieldErrors: { allowDuplicate: expect.any(String) } });
    const ok = await admitFromEnquiry(a.as.admin, id, undefined, { name: "Esha Same", dob: "2015-05-05", allowDuplicate: "true" });
    expect(ok.marked).toBe(true);
  });
});
