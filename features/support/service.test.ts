import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, supportMessages, supportTickets, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { SupportService } from "./service";

let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(["support"])); });
afterAll(closeDb);

describe("SupportService", () => {
  it("creates a ticket with its first message and lists it", async () => {
    const svc = new SupportService(a.as.admin);
    const t = await svc.create({ subject: "Fee receipts will not print", body: "The PDF is blank.", priority: "high" });
    expect(t.status).toBe("open");
    expect(t.priority).toBe("high");
    const { messages } = await svc.thread(t.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ body: "The PDF is blank.", fromStaff: false, author: a.as.admin.name });
    expect((await svc.list()).rows.map((r) => r.id)).toContain(t.id);
  });

  it("asks for a subject and a message", async () => {
    await expect(new SupportService(a.as.admin).create({ subject: "", body: "" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("only the administrator can use support", async () => {
    for (const role of ["teacher", "accountant", "student", "parent"] as const) {
      await expect(new SupportService(a.as[role]).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new SupportService(a.as[role]).create({ subject: "Hello", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("shows staff replies as support and puts a replied-to ticket back to open", async () => {
    const svc = new SupportService(a.as.admin);
    const t = await svc.create({ subject: "Login help", body: "Teacher cannot sign in" });
    await withConsole(async (tx) => {
      await tx.insert(supportMessages).values({ schoolId: a.id, ticketId: t.id, authorStaffId: crypto.randomUUID(), body: "Reset sent." });
      await tx.update(supportTickets).set({ status: "pending" }).where(eq(supportTickets.id, t.id));
    });
    const { messages } = await svc.thread(t.id);
    expect(messages.some((m) => m.fromStaff && m.author === "Triakshi support")).toBe(true);
    expect((await svc.thread(t.id)).ticket.status).toBe("pending");
    await svc.reply(t.id, { body: "Thanks, works now" });
    expect((await svc.thread(t.id)).ticket.status).toBe("open");
  });

  it("a closed ticket takes no more messages", async () => {
    const svc = new SupportService(a.as.admin);
    const t = await svc.create({ subject: "Old question", body: "x" });
    await svc.close(t.id);
    await expect(svc.reply(t.id, { body: "more" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("a read-only school cannot raise tickets", async () => {
    await expect(new SupportService({ ...a.as.admin, readOnly: true }).create({ subject: "Help", body: "x" })).rejects.toMatchObject({ code: "read_only" });
  });

  it("isolation: school B cannot see, read, reply to or close A's ticket", async () => {
    const t = await new SupportService(a.as.admin).create({ subject: "A private matter", body: "x" });
    const bSvc = new SupportService(b.as.admin);
    expect((await bSvc.list()).rows.some((r) => r.id === t.id)).toBe(false);
    await expect(bSvc.thread(t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.reply(t.id, { body: "hi" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.close(t.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the school role cannot change priority, edit messages or pose as staff", async () => {
    const svc = new SupportService(a.as.admin);
    const t = await svc.create({ subject: "Guard check", body: "hello" });
    await expect(withSchool(a.id, (tx) => tx.update(supportTickets).set({ priority: "urgent" }).where(eq(supportTickets.id, t.id)))).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.update(supportMessages).set({ body: "edited" }).where(eq(supportMessages.ticketId, t.id)))).rejects.toThrow();
    await withSchool(a.id, (tx) => tx.insert(supportMessages).values({ schoolId: a.id, ticketId: t.id, authorStaffId: crypto.randomUUID(), body: "fake" }));
    const { messages } = await svc.thread(t.id);
    expect(messages.some((m) => m.fromStaff)).toBe(false);
  });
});
