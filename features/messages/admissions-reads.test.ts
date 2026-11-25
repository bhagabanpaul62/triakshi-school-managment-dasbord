import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and } from "drizzle-orm";
import { closeDb, eq, withSchool } from "@smw/db";
import { MemoryStorage, useServices } from "@smw/integrations";
import { students } from "@smw/feature-students/schema";
import { lapse } from "./jobs";
import { messageThreads } from "./schema";
import { MessageService } from "./service";
import { addUser, build } from "./test-fixture";

let w: Awaited<ReturnType<typeof build>>;
let leftId: string, leftThread: string;

beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  w = await build("j");
  const [leftLogin, joinLogin] = await Promise.all([addUser(w.a, "student", "leftj"), addUser(w.a, "student", "joinj")]);
  leftId = await withSchool(w.a.id, async (tx) => {
    const base = { schoolId: w.a.id, classId: w.st1.classId };
    const [l] = await tx.insert(students).values({ ...base, admissionNo: "LJ", name: "Laksh Left", sectionId: w.s1, userId: leftLogin.userId }).returning();
    await tx.insert(students).values({ ...base, admissionNo: "JJ", name: "Jiya Joining", status: "joining", joinsSectionId: w.s1, userId: joinLogin.userId });
    return l!.id;
  });
  leftThread = (await new MessageService(w.a.as.admin).start({ studentId: leftId, recipientIds: [], subject: "Before he left", body: "Hello" })).id;
  await withSchool(w.a.id, (tx) => tx.update(students).set({ status: "left", leftOn: "2026-09-10" }).where(eq(students.id, leftId)));
});
afterAll(closeDb);

describe("joining and left children", () => {
  it("are nobody's contact: not in the staff list, the class teacher's list or a family's children", async () => {
    for (const who of [w.a.as.admin, w.form]) {
      const names = (await new MessageService(who).students()).map((s) => s.name);
      expect(names).not.toContain("Laksh Left");
      expect(names).not.toContain("Jiya Joining");
      expect(names).toContain("Aarav");
    }
    expect(await new MessageService(w.a.as.student).children()).toHaveLength(1);
  });

  it("keep the left child's old conversation readable, and close it when the teacher job runs", async () => {
    expect((await new MessageService(w.a.as.admin).thread(leftThread)).thread.subject).toBe("Before he left");
    await lapse(w.a.id);
    const [t] = await withSchool(w.a.id, (tx) => tx.select({ state: messageThreads.state }).from(messageThreads).where(and(eq(messageThreads.id, leftThread))));
    expect(t!.state).not.toBe("open");
  });
});
