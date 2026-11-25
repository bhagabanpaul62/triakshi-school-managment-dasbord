import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, platformAuditLogs, schoolSetupStatus, schools, supportTickets, withConsole } from "@smw/db";
import type { StaffCtx } from "@smw/feature-kit";
import { STUCK_DAYS, STUCK_PERCENT, SchoolAdminService, SetupStatusService } from "./index";

vi.setConfig({ testTimeout: 90_000 });
afterAll(closeDb);

const owner: StaffCtx = { staffId: crypto.randomUUID(), role: "owner", name: "Test owner" };
let n = 0;
const make = async (daysOld: number, percent: number | null) => {
  const tag = `su${Date.now().toString(36)}${n++}`;
  const { schoolId } = await new SchoolAdminService(owner).create({ name: `Setup ${tag}`, slug: tag, adminName: "Asha Rao", adminEmail: `${tag}@x.test` });
  await withConsole(async (tx) => {
    await tx.update(schools).set({ createdAt: new Date(Date.now() - daysOld * 86_400_000) }).where(eq(schools.id, schoolId));
    if (percent !== null) await tx.insert(schoolSetupStatus).values({ schoolId, percent, done: percent, total: 100, nextKey: "daily.attendance", nextLabel: "Mark attendance for one class" });
  });
  return { schoolId, tag };
};

describe("schools list: setup column and the Stuck filter", () => {
  it("shows the percent and next step, and Stuck means under 50% after 5 days (an active or trial school with a picture)", async () => {
    const stuck = await make(STUCK_DAYS + 2, STUCK_PERCENT - 1);
    const young = await make(1, 10);
    const fine = await make(STUCK_DAYS + 2, STUCK_PERCENT);
    const unknown = await make(STUCK_DAYS + 2, null);
    const svc = new SchoolAdminService(owner);
    const all = (await svc.list({ pageSize: 100, filters: { q: "" } })).rows;
    const row = (id: string) => all.find((r) => r.id === id)!;
    expect(row(stuck.schoolId)).toMatchObject({ setupPercent: STUCK_PERCENT - 1, setupNext: "Mark attendance for one class", stuck: true });
    expect(row(young.schoolId)).toMatchObject({ setupPercent: 10, stuck: false });
    expect(row(fine.schoolId).stuck).toBe(false);
    expect(row(unknown.schoolId)).toMatchObject({ setupPercent: null, stuck: false });

    const only = await svc.list({ pageSize: 100, filters: { stuck: "1" } });
    const ids = only.rows.map((r) => r.id);
    expect(ids).toContain(stuck.schoolId);
    for (const x of [young, fine, unknown]) expect(ids).not.toContain(x.schoolId);
    expect(only.rows.every((r) => r.stuck)).toBe(true);
    expect(only.total).toBe(only.rows.length);

    await svc.suspend(stuck.schoolId, "test");
    expect((await svc.list({ pageSize: 100, filters: { stuck: "1" } })).rows.map((r) => r.id)).not.toContain(stuck.schoolId);
  });
});

describe("Stuck counts from the owner's approval, not from signup", () => {
  it("a school that signed up long ago but was approved yesterday is not stuck yet", async () => {
    const approved = await make(40, 10);
    await withConsole((tx) => tx.insert(platformAuditLogs).values({ schoolId: approved.schoolId, action: "school.approve", summary: "Approved" }));
    const old = await make(40, 10);
    const ids = (await new SchoolAdminService(owner).list({ pageSize: 100, filters: { stuck: "1" } })).rows.map((r) => r.id);
    expect(ids).toContain(old.schoolId);
    expect(ids).not.toContain(approved.schoolId);
    expect((await new SchoolAdminService(owner).list({ pageSize: 100 })).rows.find((r) => r.id === approved.schoolId)?.stuck).toBe(false);
  });
});

describe("SetupStatusService", () => {
  it("gives the school's picture and its onboarding tickets, and nobody else's", async () => {
    const one = await make(3, 40);
    const two = await make(3, 80);
    await withConsole(async (tx) => {
      await tx.insert(supportTickets).values([
        { schoolId: one.schoolId, subject: "Setup help: Students", category: "onboarding" },
        { schoolId: one.schoolId, subject: "A billing question", category: "billing" },
        { schoolId: two.schoolId, subject: "Setup help: Year", category: "onboarding" },
      ]);
    });
    const r = await new SetupStatusService(owner).forSchool(one.schoolId);
    expect(r.status).toMatchObject({ percent: 40, nextKey: "daily.attendance" });
    expect(r.tickets.map((t) => t.subject)).toEqual(["Setup help: Students"]);
    expect((await new SetupStatusService(owner).forSchool(two.schoolId)).status?.percent).toBe(80);
    expect((await new SetupStatusService({ ...owner, role: "support" }).forSchool((await make(3, null)).schoolId)).status).toBeNull();
    await expect(new SetupStatusService(owner).forSchool("not-an-id")).rejects.toThrow();
  });
});
