import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, invoices, schools, withConsole } from "@smw/db";
import { ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { FakePaymentGateway, useServices } from "@smw/integrations";
import { BillingService } from "./service";
import feature from "./feature";

let a: TestSchool, b: TestSchool;
beforeAll(async () => {
  useServices({ payments: new FakePaymentGateway() });
  ({ a, b } = await createSchoolPair(["billing"]));
  await withConsole(async (tx) => {
    await tx.insert(invoices).values({ schoolId: a.id, number: "TRK/T/00001", financialYear: "2026-27", description: "x", taxablePaise: 100, totalPaise: 118 });
    await tx.update(schools).set({ state: "Goa" }).where(eq(schools.id, a.id));
  });
});
afterAll(closeDb);

describe("BillingService (school side)", () => {
  it("is a core feature: admin and accountant read, only admin manages", () => {
    expect(feature.core).toBe(true);
    expect(new BillingService(a.as.admin).can("manage")).toBe(true);
    expect(new BillingService(a.as.accountant).can("read")).toBe(true);
    expect(new BillingService(a.as.accountant).can("manage")).toBe(false);
    expect(new BillingService(a.as.parent).can("read")).toBe(false);
  });

  it("roles without access are refused", async () => {
    await expect(new BillingService(a.as.teacher).listInvoices()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BillingService(a.as.accountant).payInvoice("00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("isolation: school B sees none of school A's invoices and cannot download or pay them", async () => {
    expect((await new BillingService(a.as.admin).listInvoices()).total).toBe(1);
    const bSvc = new BillingService(b.as.admin);
    expect((await bSvc.listInvoices()).total).toBe(0);
    const [inv] = await withConsole((tx) => tx.select().from(invoices).where(eq(invoices.schoolId, a.id)));
    await expect(bSvc.invoicePdf(inv!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.payInvoice(inv!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.invoicePdf("not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
  });
});
