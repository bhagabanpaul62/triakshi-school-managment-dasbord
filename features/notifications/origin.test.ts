import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schoolUrl } from "@smw/config";
import { closeDb, schoolDomains, withConsole } from "@smw/db";
import { createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { schoolOrigins } from "@smw/runtime/host";
import { compose } from "./delivery";

let s: TestSchool, domainId: string;
const day = 86_400_000;
beforeAll(async () => {
  s = await createTestSchool("mailorigin", ["notifications"]);
  domainId = (await withConsole(async (tx) => (await tx.insert(schoolDomains).values({
    schoolId: s.id, hostname: "www.mail-school.in", kind: "custom", status: "verified", isPrimary: true, verifyToken: "t", health: "ok",
    certExpiresAt: new Date(Date.now() + 60 * day), records: [{ key: "https", ok: true, expected: "x", found: [] }],
  }).returning())[0]!)).id;
});
afterAll(closeDb);
const set = (p: Partial<typeof schoolDomains.$inferInsert>) => withConsole((tx) => tx.update(schoolDomains).set(p).where(eq(schoolDomains.id, domainId)));
/** The link in the mail, built the way the delivery loader builds the school: through schoolOrigins. */
async function linkInMail() {
  const origin = (await withConsole((tx) => schoolOrigins(tx, [{ id: s.id, slug: s.slug }]))).get(s.id);
  const plan = { row: {}, note: { topic: "work.update", title: "Fees due", body: null, href: "/app/fees", privateBody: false }, person: { name: "Riya" }, address: "a@b.test", limited: false, guardian: true };
  const mail = compose({ name: "School", slug: s.slug, origin }, [plan as never], false);
  return /Open it: (\S+)/.exec(mail.text!)![1]!;
}

describe("8: mail links to families use the main domain only while it is healthy", () => {
  it("healthy main domain", async () => expect(await linkInMail()).toMatch(/^https?:\/\/www\.mail-school\.in\/app\/fees$/));
  it("broken, or no working certificate: the free address", async () => {
    await set({ health: "broken" });
    expect(await linkInMail()).toBe(schoolUrl(s.slug, "/app/fees"));
    await set({ health: "ok", certExpiresAt: null });
    expect(await linkInMail()).toBe(schoolUrl(s.slug, "/app/fees"));
  });
});
