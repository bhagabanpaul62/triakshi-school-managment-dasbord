// The QR on a circular must open a page, so the app's own lookup map has to know the kind.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@smw/db";
import { publishNow } from "@smw/feature-announcements/quick";
import { verifyToken } from "@smw/feature-announcements/verify";
import { build, type Fx } from "@smw/feature-announcements/fixtures";
import { checkDocument } from "@smw/feature-finance/templates/verify";
import { MemoryStorage, useServices } from "@smw/integrations";
import { VERIFY_LOOKUPS } from "./verify-lookups";

let fx: Fx;
beforeAll(async () => { useServices({ storage: new MemoryStorage() }); fx = await build("vl1"); });
afterAll(closeDb);

describe("VERIFY_LOOKUPS", () => {
  it("knows the circular kind, and a circular's QR token is genuine through the app map", async () => {
    expect(Object.keys(VERIFY_LOOKUPS)).toContain("circular");
    const { id, number } = await publishNow(fx.school.as.admin, { type: "circular", title: "Uniform change", body: "x", audience: { include: [{ type: "everyone" }], exclude: [] } });
    const found = await checkDocument(VERIFY_LOOKUPS, fx.school.id, "circular", verifyToken(fx.school.id, id)!);
    expect(found).toMatchObject({ ok: true, status: "Genuine", number, title: "Uniform change" });
    expect(await checkDocument(VERIFY_LOOKUPS, fx.school.id, "circular", "0".repeat(32))).toBeNull();
  });
});
