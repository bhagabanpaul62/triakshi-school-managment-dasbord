// Website rule in one place, and a notice that can never be sent does not stay "sending" for ever.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { ForbiddenError, type Ctx } from "@smw/feature-kit";
import { notifications } from "@smw/feature-notifications/schema";
import { CommSettingsService } from "@smw/feature-notifications/settings";
import { MemoryStorage, useServices } from "@smw/integrations";
import { NoticeService } from "./service";
import { build, type Fx } from "./fixtures";
import { publishDue } from "./jobs";
import { publishNow } from "./quick";
import { announcements } from "./schema";

const broken = vi.hoisted(() => ({ on: false }));
vi.mock("./lifecycle", async () => {
  const real = await vi.importActual<typeof import("./lifecycle")>("./lifecycle");
  return { ...real, giveNumber: (...a: Parameters<typeof real.giveNumber>) => (broken.on ? Promise.reject(new Error("the number could not be given")) : real.giveNumber(...a)) };
});

let fx: Fx;
const ALL = { include: [{ type: "everyone" }], exclude: [] };
const row = async (id: string) => (await withSchool(fx.school.id, (tx) => tx.select().from(announcements).where(eq(announcements.id, id))))[0]!;
const custom = (grants: string[]): Ctx => ({ ...fx.school.as.admin, role: "accountant", grants: new Set(grants) });

beforeAll(async () => { useServices({ storage: new MemoryStorage() }); fx = await build("cr"); });
afterAll(closeDb);

describe("the website rule", () => {
  it("correct() turns the website on only for a person who may, by the same rule as publish", async () => {
    const c = custom(["announcements:read", "announcements:draft", "announcements:publish", "announcements:whole"]);
    const { id } = await publishNow(c, { title: "Open day", body: "x", audience: ALL });
    await expect(new NoticeService(c).correct({ id, edits: { website: true } })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await row(id)).website).toBe(false);
    const off = { families: false, wholeSchool: false, website: false };
    await new CommSettingsService(fx.school.as.admin).save({ approvalFor: off });
    await new NoticeService(c).correct({ id, edits: { website: true } });
    expect((await row(id)).website).toBe(true);
    await new CommSettingsService(fx.school.as.admin).save({ approvalFor: { ...off, website: true } });
    const other = await publishNow(fx.school.as.admin, { title: "Admin day", body: "x", audience: ALL });
    await new NoticeService(fx.school.as.admin).correct({ id: other.id, edits: { website: true } });
    expect((await row(other.id)).website).toBe(true);
  });
});

describe("a notice that can never be sent", () => {
  it("goes back to a draft after 3 failed runs, with the reason, and tells the writer", async () => {
    const admin = new NoticeService(fx.school.as.admin);
    const { id } = await admin.saveDraft({ type: "circular", title: "Stuck", body: "x", audience: ALL });
    await admin.publish(id);
    await withSchool(fx.school.id, (tx) => tx.execute(sql`update announcements set send_at = now() - interval '1 second' where id = ${id}::uuid`));
    broken.on = true;
    try {
      for (const left of [true, true, false]) {
        await expect(publishDue()).rejects.toThrow();
        expect((await row(id)).state).toBe(left ? "sending" : "draft");
      }
    } finally { broken.on = false; }
    const n = await row(id);
    expect(n.reviewNote).toMatch(/^Could not be sent: .*the number could not be given/);
    const told = await withSchool(fx.school.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.userId, fx.school.users.admin), eq(notifications.subjectId, id))));
    expect(told.some((t) => t.action && /Could not be sent/.test(t.title))).toBe(true);
  });
});
