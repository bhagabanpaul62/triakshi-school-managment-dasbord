import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql, withSchool } from "@smw/db";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { checkDocument, maskName, type VerifyLookups } from "./verify";

let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(["finance"], "-vf")); });
afterAll(closeDb);

const TOKEN = "AbCdEfGhIjKlMnOp0123";
const lookups: VerifyLookups = {
  receipt: async (tx, token) => {
    const [row] = await tx.execute<{ school: string }>(sql`select current_setting('app.school_id') as school`);
    return token === TOKEN ? { status: "Valid", ok: true, number: `RCP/${row!.school}`, date: "2026-11-24", amountPaise: 123_456, studentName: "Priya Sharma Kshatriya" } : null;
  },
};

describe("public check", () => {
  it("masks names word by word, in any script", () => {
    expect(maskName("Rakesh Sharma")).toBe("R*** S***");
    expect(maskName("  priya   ")).toBe("p***");
    expect(maskName("प्रिया शर्मा")).toBe("प***  श***".replace("  ", " "));
    expect(maskName("")).toBeNull();
    expect(maskName(null)).toBeNull();
  });
  it("returns only the fields the page may show, with the name masked", async () => {
    const r = await checkDocument(lookups, a.id, "receipt", TOKEN);
    expect(Object.keys(r!).sort()).toEqual(["amountPaise", "date", "maskedName", "number", "ok", "status"]);
    expect(r!.maskedName).toBe("P*** S*** K***");
    expect(JSON.stringify(r)).not.toContain("Priya");
  });
  it("gives the same nothing for an unknown kind, a malformed token and an unknown token", async () => {
    const out = await Promise.all([
      checkDocument(lookups, a.id, "invoice", TOKEN), checkDocument(lookups, a.id, "receipt", "short"), checkDocument(lookups, a.id, "receipt", "ZZZZZZZZZZZZZZZZZZZZ"),
      checkDocument(lookups, a.id, "__proto__", TOKEN), checkDocument(lookups, a.id, "toString", TOKEN),
    ]);
    expect(out).toEqual([null, null, null, null, null]);
  });
  it("runs the lookup inside the host school's scope only", async () => {
    expect((await checkDocument(lookups, a.id, "receipt", TOKEN))!.number).toBe(`RCP/${a.id}`);
    expect((await checkDocument(lookups, b.id, "receipt", TOKEN))!.number).toBe(`RCP/${b.id}`);
    void withSchool;
  });
});
