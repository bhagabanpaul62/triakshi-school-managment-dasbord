import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, platformStaff, withConsole } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices, type Mail } from "@smw/integrations";

process.env.SUPPORT_EMAIL = "help@triakshi.test";
const sent: Mail[] = [];
let a: TestSchool;
beforeAll(async () => {
  useServices({ storage: new MemoryStorage(), email: { send: async (m: Mail) => { sent.push(m); } } });
  ({ a } = await createSchoolPair(["support", "notifications"], "k"));
  await withConsole((tx) => tx.insert(platformStaff).values({ email: "owner2@triakshi.test", name: "O", role: "owner", passwordHash: "x" }));
});
afterAll(closeDb);

describe("SUPPORT_EMAIL", () => {
  it("new tickets go to the support address, not to each staff member", async () => {
    const { SupportService } = await import("./service");
    const { SupportJobs } = await import("./jobs");
    const t = await new SupportService(a.as.teacher).create({ subject: "Address test", body: "x" });
    await new SupportJobs().tell();
    expect(sent.filter((m) => m.text.includes(t.id)).map((m) => m.to)).toEqual(["help@triakshi.test"]);
  });
});
