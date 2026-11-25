import { afterAll, describe, expect, it } from "vitest";
import { closeDb, supportVisits, withConsole } from "@smw/db";
import { createTestSchool } from "@smw/feature-kit/testing";
import { supportSessionAllowed } from "./support-session";

afterAll(closeDb);
const staffId = crypto.randomUUID();
const row = (supportAccess: string, supportAccessUntil: Date | null = null) => ({ supportAccess, supportAccessUntil });

describe("a support session after the school says no", () => {
  it("a normal user is never asked about, and 'always' keeps the session", async () => {
    const s = await createTestSchool("ss1", []);
    expect(await supportSessionAllowed({ id: s.id, row: row("never") }, null)).toBe(true);
    expect(await supportSessionAllowed({ id: s.id, row: row("always") }, staffId)).toBe(true);
  });
  it("'never', or an 'until' that has passed, ends the session; a future 'until' keeps it", async () => {
    const s = await createTestSchool("ss2", []);
    expect(await supportSessionAllowed({ id: s.id, row: row("never") }, staffId)).toBe(false);
    expect(await supportSessionAllowed({ id: s.id, row: row("until", new Date(Date.now() - 1000)) }, staffId)).toBe(false);
    expect(await supportSessionAllowed({ id: s.id, row: row("until", new Date(Date.now() + 60_000)) }, staffId)).toBe(true);
  });
  it("an owner's emergency visit by the same person keeps it; another person's does not", async () => {
    const s = await createTestSchool("ss3", []);
    await withConsole((tx) => tx.insert(supportVisits).values({ schoolId: s.id, staffId, staffName: "Olga", asUserId: s.users.admin, asUserName: "a", reason: "Data loss reported", readOnly: true, emergency: true, enteredAt: new Date() }));
    expect(await supportSessionAllowed({ id: s.id, row: row("never") }, staffId)).toBe(true);
    expect(await supportSessionAllowed({ id: s.id, row: row("never") }, crypto.randomUUID())).toBe(false);
  });
});
