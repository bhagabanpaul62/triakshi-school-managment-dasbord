import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schoolUrl } from "@smw/config";
import { closeDb, schoolDomains, withConsole } from "@smw/db";
import { createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { schoolOrigins } from "@smw/runtime/host";

const schoolOrigin = (id: string, slug: string) => withConsole(async (tx) => (await schoolOrigins(tx, [{ id, slug }])).get(id)!);
let s: TestSchool;
let domainId: string;
beforeAll(async () => {
  s = await createTestSchool("origin", ["domains"]);
  domainId = (await withConsole(async (tx) => (await tx.insert(schoolDomains).values({ schoolId: s.id, hostname: "www.origin-school.in", kind: "custom", status: "verified", isPrimary: true, verifyToken: "t", health: "ok", certExpiresAt: new Date(Date.now() + 60 * 86_400_000), records: [{ key: "https", ok: true, expected: "A valid certificate", found: [] }] }).returning())[0]!)).id;
});
afterAll(closeDb);
const set = (p: Partial<typeof schoolDomains.$inferInsert>) => withConsole((tx) => tx.update(schoolDomains).set(p).where(eq(schoolDomains.id, domainId)));

describe("schoolOrigin: where links in mails to families start (D1)", () => {
  it("the healthy main domain", async () => {
    expect(await schoolOrigin(s.id, s.slug)).toMatch(/^https?:\/\/www\.origin-school\.in$/);
  });
  it("a warning still counts as healthy; a broken one falls back to the free address", async () => {
    await set({ health: "warning" });
    expect(await schoolOrigin(s.id, s.slug)).toContain("www.origin-school.in");
    await set({ health: "broken" });
    expect(await schoolOrigin(s.id, s.slug)).toBe(schoolUrl(s.slug));
  });
  it("1: a domain without a working certificate is not used, however healthy the rest", async () => {
    await set({ health: "ok", certExpiresAt: null, records: [{ key: "https", ok: false, expected: "A valid certificate", found: [] }] });
    expect(await schoolOrigin(s.id, s.slug)).toBe(schoolUrl(s.slug));
    await set({ certExpiresAt: new Date(Date.now() - 1000), records: [{ key: "https", ok: true, expected: "x", found: [] }] });
    expect(await schoolOrigin(s.id, s.slug)).toBe(schoolUrl(s.slug));
    await set({ certExpiresAt: new Date(Date.now() + 86_400_000) });
    expect(await schoolOrigin(s.id, s.slug)).toContain("www.origin-school.in");
  });
  it("a released or unverified main domain is never used", async () => {
    await set({ health: "ok", status: "failed" });
    expect(await schoolOrigin(s.id, s.slug)).toBe(schoolUrl(s.slug));
    await set({ status: "verified", isPrimary: false });
    expect(await schoolOrigin(s.id, s.slug)).toBe(schoolUrl(s.slug));
  });
});
