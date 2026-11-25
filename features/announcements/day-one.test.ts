// First-day fixes: who a check reaches, the order of "needs your answer", one tap on an urgent alert, a withdrawn card, the words on buttons.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { channelsFor } from "@smw/feature-notifications/channels";
import { guardians, studentGuardians } from "../students/schema";
import { FeedService, NoticeService, ReportService, ResponseService } from "./service";
import { ackButton, answerButtons, stop } from "./content";
import { answerText } from "./answer-text";
import { build, type Fx } from "./fixtures";
import { publishNow } from "./quick";

let fx: Fx;
const A = () => fx.school.as;
const ALL = { include: [{ type: "everyone" }], exclude: [] };
const days = (n: number) => new Date(Date.now() + n * 864e5);
const needs = async () => (await new FeedService(A().student).feed({ pageSize: 50 })).rows.filter((r) => r.needsAnswer).map((r) => r.title);

beforeAll(async () => { fx = await build("dayone"); });
afterAll(closeDb);

describe("plain words", () => {
  it("ends a reason with one full stop", () => {
    expect(stop("Moved to Saturday.")).toBe("Moved to Saturday.");
    expect(stop("Moved to Saturday ")).toBe("Moved to Saturday.");
    expect(stop("Why?")).toBe("Why?");
  });
  it("the preview shows the buttons the family card has", () => {
    expect(answerButtons("ack", true)).toEqual([ackButton(true)]);
    expect(answerButtons("ack", false)).toEqual(["I have read this"]);
    expect(answerButtons("consent", false)).toEqual(["Yes", "No", "Save my answer"]);
    expect(answerButtons("none", false)).toEqual([]);
  });
  it("an urgent answer is Safe in reports", () => {
    expect(answerText({ kind: "ack" }, true)).toBe("Safe");
    expect(answerText({ kind: "ack" })).toBe("Read");
  });
  it("an approval request is pushed by default", () => {
    expect(channelsFor("notice.approval").push).toBe(true);
  });
});

describe("publish check", () => {
  it("says how many students and classes the school has, so a check that reaches nobody can say what to add", async () => {
    expect((await new NoticeService(A().admin).reachFor(ALL)).school).toEqual({ students: 4, classes: 2 });
  });
});

describe("needs your answer order", () => {
  it("urgent first, then due within 7 days soonest first, then undated newest first, then due later", async () => {
    const ack = { kind: "ack" };
    for (const [title, extra] of [["Old undated", {}], ["Due later", { dueAt: days(30) }], ["Due soon", { dueAt: days(3) }], ["New undated", {}]] as const)
      await publishNow(A().admin, { title, body: "x", audience: ALL, response: ack, ...extra });
    await publishNow(A().admin, { type: "urgent", title: "Alert", body: "x", audience: ALL });
    expect(await needs()).toEqual(["Alert", "Due soon", "New undated", "Old undated", "Due later"]);
  });
});

describe("one tap on an urgent alert", () => {
  it("saves with no name, asks for it after, and reads Safe", async () => {
    const { id } = await publishNow(A().admin, { type: "urgent", title: "Rain alert", body: "x", audience: ALL });
    const family = new ResponseService(A().student);
    await family.respond({ noticeId: id, answer: { kind: "ack" } });
    const rows = (await new ReportService(A().admin).people(id, { filter: "answered" })).rows;
    expect(rows.find((r) => r.name === "Ann")).toMatchObject({ answerText: "Safe", byName: "" });
    await family.respond({ noticeId: id, answer: { kind: "ack" }, byName: "Asha Rao", byRelation: "Mother" });
    expect((await new ReportService(A().admin).people(id, { filter: "answered" })).rows.find((r) => r.name === "Ann")).toMatchObject({ byName: "Asha Rao", byRelation: "Mother" });
    // a second tap with no name keeps the name already given
    await family.respond({ noticeId: id, answer: { kind: "ack" } });
    expect((await new ReportService(A().admin).people(id, { filter: "answered" })).rows.find((r) => r.name === "Ann")).toMatchObject({ byName: "Asha Rao" });
  });

  it("still needs a name for any other answer", async () => {
    const { id } = await publishNow(A().admin, { title: "Read this", body: "x", audience: ALL, response: { kind: "ack" } });
    await expect(new ResponseService(A().student).respond({ noticeId: id, answer: { kind: "ack" } })).rejects.toMatchObject({ fieldErrors: { byName: expect.any(String) } });
  });

  it("offers the guardian on the student record", async () => {
    await withSchool(fx.school.id, async (tx) => {
      const [g] = await tx.insert(guardians).values({ schoolId: fx.school.id, name: "Asha Rao", relation: "mother" }).returning();
      await tx.insert(studentGuardians).values({ schoolId: fx.school.id, studentId: fx.ids.ann!, guardianId: g!.id, isPrimary: true });
    });
    const { id } = await publishNow(A().admin, { type: "urgent", title: "Second alert", body: "x", audience: ALL });
    expect((await new FeedService(A().student).open(id)).recipients[0]!.guardian).toEqual({ name: "Asha Rao", relation: "Mother" });
  });
});

describe("a withdrawn card", () => {
  it("keeps its title and carries the reason", async () => {
    const { id } = await publishNow(A().admin, { title: "Picnic on Friday", body: "x", audience: ALL });
    await new NoticeService(A().admin).withdraw(id, "Moved to Saturday.");
    const row = (await new FeedService(A().student).feed({ pageSize: 50 })).rows.find((r) => r.noticeId === id)!;
    expect(row).toMatchObject({ title: "Picnic on Friday", excerpt: "Moved to Saturday.", withdrawn: true });
  });
});
