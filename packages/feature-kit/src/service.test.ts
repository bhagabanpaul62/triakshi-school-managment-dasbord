// Proves the base classes: permissions, module and read-only guards, and school A vs B isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { closeDb, schoolDb, sql, supportTickets, withSchool } from "@smw/db";
import { CrudService, defineFeature, FeatureOffError, ForbiddenError, NotFoundError, ReadOnlyError, ValidationError } from "./index";
import { createSchoolPair, type TestSchool } from "./testing";

const support = defineFeature({
  key: "support", name: "Support", description: "test", stage: "ga",
  permissions: { read: ["admin", "teacher"], write: ["admin"] },
});

class TicketService extends CrudService<typeof supportTickets, "read" | "write"> {
  protected feature = support;
  protected table = supportTickets;
  protected entityName = "Ticket";
  protected readPermission = "read" as const;
  protected writePermission = "write" as const;
  protected createSchema = z.object({ subject: z.string().min(3) });
  protected updateSchema = z.object({ subject: z.string().min(3) });
  protected searchColumns() { return [supportTickets.subject]; }
  protected describe(r: typeof supportTickets.$inferSelect) { return r.subject; }
}

let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(["support"])); });
afterAll(closeDb);

describe("CrudService", () => {
  it("creates, lists and searches within the school", async () => {
    const svc = new TicketService(a.as.admin);
    await svc.create({ subject: "Projector broken" });
    await svc.create({ subject: "Fee report wrong" });
    const page = await svc.list({ q: "fee" });
    expect(page.total).toBe(1);
    expect(page.rows[0]!.subject).toBe("Fee report wrong");
  });

  it("school B cannot read, change or delete school A's rows", async () => {
    const t = await new TicketService(a.as.admin).create({ subject: "Secret of A" });
    const asB = new TicketService(b.as.admin);
    expect((await asB.list()).rows.find((r) => r.id === t.id)).toBeUndefined();
    await expect(asB.get(t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(asB.update(t.id, { subject: "hacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(asB.remove(t.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new TicketService(a.as.admin).get(t.id)).subject).toBe("Secret of A");
  });

  it("RLS blocks a query that forgets the school filter", async () => {
    await withSchool(b.id, async (tx) => {
      const rows = await tx.select().from(supportTickets);
      expect(rows.every((r) => r.schoolId === b.id)).toBe(true);
    });
    const raw = await schoolDb().execute(sql`select count(*)::int as n from support_tickets`);
    expect(raw[0]!.n).toBe(0);
  });

  it("RLS rejects inserting a row for another school", async () => {
    await expect(withSchool(b.id, (tx) => tx.insert(supportTickets).values({ schoolId: a.id, subject: "sneaky" }))).rejects.toThrow();
  });

  it("enforces permissions, modules and read-only", async () => {
    await expect(new TicketService(a.as.teacher).create({ subject: "nope" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new TicketService(a.as.parent).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new TicketService({ ...a.as.admin, features: new Set() }).list()).rejects.toBeInstanceOf(FeatureOffError);
    await expect(new TicketService({ ...a.as.admin, readOnly: true }).create({ subject: "nope" })).rejects.toBeInstanceOf(ReadOnlyError);
    expect((await new TicketService({ ...a.as.admin, readOnly: true }).list()).total).toBeGreaterThan(0);
  });

  it("validates input with field errors", async () => {
    const err = await new TicketService(a.as.admin).create({ subject: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fieldErrors.subject).toBeTruthy();
  });

  it("writes the audit log in the same transaction", async () => {
    await withSchool(a.id, async (tx) => {
      const rows = await tx.execute(sql`select count(*)::int as n from audit_logs where module = 'support'`);
      expect(rows[0]!.n).toBeGreaterThan(0);
    });
  });
});
