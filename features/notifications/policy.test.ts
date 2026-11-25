import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { defineFeature, ForbiddenError, type Ctx, type FeatureDef } from "@smw/feature-kit";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections, sectionTeachers, subjects } from "../academics/schema";
import { students } from "../students/schema";
import notificationsFeature from "./feature";
import { AudiencePolicy } from "./policy";
import { CommSettingsService } from "./settings";
import { commGroups } from "./schema";
import type { Audience, AudienceRule } from "./audience-rules";

const aud = (include: AudienceRule[], exclude: AudienceRule[] = []): Audience => ({ include, exclude });
let a: TestSchool;
const f: Record<string, string> = {};
const staffSide = ["admin", "accountant", "teacher"] as const;
const FEATURES = {
  announcements: defineFeature({ key: "announcements", name: "", description: "", stage: "ga", permissions: { publish: staffSide, manage: ["admin"] } }),
  events: defineFeature({ key: "events", name: "", description: "", stage: "ga", permissions: { write: ["admin", "teacher"], manage: ["admin"] } }),
  messages: defineFeature({ key: "messages", name: "", description: "", stage: "ga", permissions: { use: staffSide, all: ["admin", "accountant"], manage: ["admin"] } }),
};
const reach = (ctx: Ctx, au: Audience, module: keyof typeof FEATURES = "announcements", permission = "publish") =>
  withSchool(a.id, (tx) => AudiencePolicy.reach(tx, { ...ctx, features: new Set([...ctx.features, ...Object.keys(FEATURES)]) }, au, { feature: FEATURES[module] as FeatureDef<string>, permission }));
const custom = (grants: string[], role: Ctx["role"] = "staff"): Ctx => ({ ...a.as.accountant, role, grants: new Set(grants) });

beforeAll(async () => {
  await registerFeatures([notificationsFeature]);
  ({ a } = await createSchoolPair(["notifications"], "p"));
  await withSchool(a.id, async (tx) => {
    const [y] = await tx.insert(academicYears).values({ schoolId: a.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [c5, c6] = await tx.insert(classes).values([{ schoolId: a.id, name: "5", grade: 5 }, { schoolId: a.id, name: "6", grade: 6 }]).returning();
    const [s5a, s5b, s6a] = await tx.insert(sections).values([
      { schoolId: a.id, classId: c5!.id, yearId: y!.id, name: "A", classTeacherId: a.users.teacher },
      { schoolId: a.id, classId: c5!.id, yearId: y!.id, name: "B" },
      { schoolId: a.id, classId: c6!.id, yearId: y!.id, name: "A" },
    ]).returning();
    const [math] = await tx.insert(subjects).values({ schoolId: a.id, name: "Maths" }).returning();
    await tx.insert(sectionTeachers).values({ schoolId: a.id, sectionId: s5b!.id, subjectId: math!.id, teacherId: a.users.teacher });
    const [mine, other] = await tx.insert(students).values([
      { schoolId: a.id, admissionNo: "M", name: "Mine", classId: c5!.id, sectionId: s5a!.id },
      { schoolId: a.id, admissionNo: "O", name: "Other", classId: c6!.id, sectionId: s6a!.id },
    ]).returning();
    const [gOwn, gOther] = await tx.insert(commGroups).values([
      { schoolId: a.id, name: "Own", audience: aud([{ type: "section", id: s5a!.id }, { type: "student", id: mine!.id }]) },
      { schoolId: a.id, name: "Elsewhere", audience: aud([{ type: "section", id: s6a!.id }]) },
    ]).returning();
    Object.assign(f, { c5: c5!.id, c6: c6!.id, s5a: s5a!.id, s5b: s5b!.id, s6a: s6a!.id, math: math!.id, mine: mine!.id, other: other!.id, gOwn: gOwn!.id, gOther: gOther!.id });
  });
});
afterAll(closeDb);

describe("who may reach whom", () => {
  it("admin and a manage grant are always free", async () => {
    expect(await reach(a.as.admin, aud([{ type: "everyone" }]))).toBe("free");
    expect(await reach(custom(["announcements:publish", "announcements:manage"]), aud([{ type: "everyone" }]))).toBe("free");
  });

  it("a teacher is free inside their own sections, subjects, students, classes and groups", async () => {
    const t = a.as.teacher;
    expect(await reach(t, aud([{ type: "section", id: f.s5a! }, { type: "section", id: f.s5b! }]))).toBe("free");
    expect(await reach(t, aud([{ type: "subject", id: f.math!, sectionId: f.s5b! }]))).toBe("free");
    expect(await reach(t, aud([{ type: "student", id: f.mine! }]))).toBe("free");
    expect(await reach(t, aud([{ type: "class", id: f.c5! }]))).toBe("free"); // both sections are theirs
    expect(await reach(t, aud([{ type: "group", id: f.gOwn! }]))).toBe("free");
    expect(await reach(t, aud([{ type: "section", id: f.s5a! }], [{ type: "student", id: f.other! }]))).toBe("free");
  });

  it("a teacher needs approval for anything wider", async () => {
    const t = a.as.teacher;
    expect(await reach(t, aud([{ type: "section", id: f.s6a! }]))).toBe("approval");
    expect(await reach(t, aud([{ type: "section", id: f.s5a! }, { type: "section", id: f.s6a! }]))).toBe("approval");
    expect(await reach(t, aud([{ type: "class", id: f.c6! }]))).toBe("approval");
    expect(await reach(t, aud([{ type: "student", id: f.other! }]))).toBe("approval");
    expect(await reach(t, aud([{ type: "subject", id: f.math! }]))).toBe("approval");
    expect(await reach(t, aud([{ type: "group", id: f.gOther! }]))).toBe("approval");
    expect(await reach(t, aud([{ type: "everyone" }]))).toBe("approval");
    expect(await reach(t, aud([{ type: "families" }]))).toBe("approval");
  });

  it("the fees list is never a teacher's, and needs fees or finance access for anyone else", async () => {
    const dues = aud([{ type: "fee_overdue", days: 30 }]);
    await expect(reach(a.as.teacher, dues)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reach(a.as.teacher, aud([{ type: "section", id: f.s5a! }], [{ type: "fee_overdue", days: 30 }]))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await reach(a.as.accountant, dues)).toBe("free");
    expect(await reach(a.as.admin, dues)).toBe("free");
    await expect(reach(custom(["announcements:publish"]), dues)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await reach(custom(["announcements:publish", "finance:read"]), dues)).toBe("free");
    await expect(reach(custom(["announcements:publish", "fees:read"], "teacher"), dues)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("families and anyone without the permission are refused", async () => {
    await expect(reach(a.as.student, aud([{ type: "everyone" }]))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reach(a.as.parent, aud([{ type: "everyone" }]))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reach(a.as.accountant, aud([{ type: "everyone" }]), "events", "write")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reach(custom(["fees:read"]), aud([{ type: "everyone" }]))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("other staff holding the permission are free; a custom role follows its grants", async () => {
    expect(await reach(a.as.accountant, aud([{ type: "families" }]))).toBe("free");
    expect(await reach(custom(["announcements:publish"]), aud([{ type: "staff" }]))).toBe("free");
    expect(await reach(a.as.teacher, aud([{ type: "section", id: f.s5a! }]), "events", "write")).toBe("free");
    expect(await reach(a.as.teacher, aud([{ type: "everyone" }]), "events", "write")).toBe("approval");
  });
});

describe("school settings", () => {
  it("teachers publish with approval when the school says so, for notices only", async () => {
    await new CommSettingsService(a.as.admin).save({ teacherPublish: "approval" });
    expect(await reach(a.as.teacher, aud([{ type: "section", id: f.s5a! }]))).toBe("approval");
    expect(await reach(a.as.teacher, aud([{ type: "section", id: f.s5a! }]), "events", "write")).toBe("free");
    expect(await reach(a.as.admin, aud([{ type: "everyone" }]))).toBe("free");
    await new CommSettingsService(a.as.admin).save({ teacherPublish: "free" });
  });

  it("approvalFor families and whole school applies to everyone but admins", async () => {
    await new CommSettingsService(a.as.admin).save({ approvalFor: { families: true, wholeSchool: false, website: true } });
    expect(await reach(a.as.accountant, aud([{ type: "families" }]))).toBe("approval");
    expect(await reach(a.as.accountant, aud([{ type: "staff" }]))).toBe("free");
    expect(await reach(a.as.admin, aud([{ type: "families" }]))).toBe("free");
    await new CommSettingsService(a.as.admin).save({ approvalFor: { families: false, wholeSchool: true, website: true } });
    expect(await reach(a.as.accountant, aud([{ type: "everyone" }]))).toBe("approval");
    expect(await reach(a.as.accountant, aud([{ type: "families" }]))).toBe("free");
    expect(await reach(custom(["announcements:publish", "announcements:manage"]), aud([{ type: "everyone" }]))).toBe("free");
    await new CommSettingsService(a.as.admin).save({ approvalFor: { families: false, wholeSchool: false, website: true } });
  });
});
