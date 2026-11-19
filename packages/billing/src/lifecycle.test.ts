import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, plans, schools, subscriptions, withConsole } from "@smw/db";
import { MemoryEmailSender, useServices } from "@smw/integrations";
import { LifecycleService, addDays } from "./index";

const NOW = new Date("2027-01-15T06:00:00Z");
const mail = new MemoryEmailSender();
let planId: string;
const ids: Record<string, string> = {};

async function school(key: string, v: Partial<typeof schools.$inferInsert>) {
  const [s] = await withConsole((tx) => tx.insert(schools).values({ slug: `lc-${key}`, name: `LC ${key}`, email: `${key}@lc.test`, ...v }).returning());
  ids[key] = s!.id;
  return s!;
}
async function sub(key: string, status: "active" | "past_due", end: Date) {
  await withConsole((tx) => tx.insert(subscriptions).values({ schoolId: ids[key]!, planId, interval: "annual", status, pricePaise: 100, currentPeriodStart: addDays(end, -365), currentPeriodEnd: end }));
}
const get = async (key: string) => (await withConsole((tx) => tx.select().from(schools).where(eq(schools.id, ids[key]!))))[0]!;

beforeAll(async () => {
  useServices({ email: mail });
  const [p] = await withConsole((tx) => tx.insert(plans).values({ key: "lc", name: "LC", studentCap: 10, priceAnnualPaise: 100, priceMonthlyPaise: 10 }).returning());
  planId = p!.id;
  await school("trial-over", { status: "trial", trialEndsAt: addDays(NOW, -1) });
  await school("trial-live", { status: "trial", trialEndsAt: addDays(NOW, 3) });
  await school("ro-old", { status: "read_only", statusChangedAt: addDays(NOW, -15) });
  await school("ro-new", { status: "read_only", statusChangedAt: addDays(NOW, -5) });
  await school("susp-old", { status: "suspended", statusChangedAt: addDays(NOW, -91) });
  await school("susp-new", { status: "suspended", statusChangedAt: addDays(NOW, -89) });
  await school("lapsed", { status: "active" });
  await sub("lapsed", "active", addDays(NOW, -1));
  await school("pd-old", { status: "past_due", statusChangedAt: addDays(NOW, -16) });
  await school("pd-new", { status: "past_due", statusChangedAt: addDays(NOW, -10) });
  await school("renew-soon", { status: "active" });
  await sub("renew-soon", "active", new Date(NOW.getTime() + 7 * 86_400_000 - 3_600_000)); // reminder day -7 reached an hour ago
  await school("healthy", { status: "active" });
  await sub("healthy", "active", addDays(NOW, 200));
});
afterAll(closeDb);

describe("LifecycleService.runDaily", () => {
  it("moves each school one step, and only when its time is up", async () => {
    const report = await new LifecycleService().runDaily(NOW);
    expect(report.trialsEnded).toBeGreaterThanOrEqual(1);

    expect((await get("trial-over")).status).toBe("read_only");
    expect((await get("trial-over")).statusChangedAt!.getTime()).toBe(NOW.getTime());
    expect((await get("trial-live")).status).toBe("trial");
    expect((await get("ro-old")).status).toBe("suspended");
    expect((await get("ro-new")).status).toBe("read_only");
    expect((await get("susp-old")).deletionScheduledAt?.getTime()).toBe(NOW.getTime());
    expect((await get("susp-new")).deletionScheduledAt).toBeNull();
    expect((await get("lapsed")).status).toBe("past_due");
    expect((await get("pd-old")).status).toBe("read_only");
    expect((await get("pd-new")).status).toBe("past_due");
    expect((await get("healthy")).status).toBe("active");
    const [s] = await withConsole((tx) => tx.select().from(subscriptions).where(eq(subscriptions.schoolId, ids.lapsed!)));
    expect(s!.status).toBe("past_due");
  });

  it("does not cascade: a school that just became read_only is not suspended in the same run", async () => {
    expect((await get("trial-over")).status).toBe("read_only");
    expect((await get("pd-old")).status).toBe("read_only");
  });

  it("emails the renewal reminder once, and the final notice to the school scheduled for deletion", async () => {
    const to = (key: string) => mail.sent.filter((m) => m.to === `${key}@lc.test`);
    expect(to("renew-soon")).toHaveLength(1);
    expect(to("renew-soon")[0]!.subject).toMatch(/renews on/);
    expect(to("susp-old")[0]!.subject).toMatch(/Final notice/);
    expect(to("healthy")).toHaveLength(0);
    await new LifecycleService().runDaily(NOW);
    await new LifecycleService().runDaily(new Date(NOW.getTime() + 3_600_000));
    expect(to("renew-soon")).toHaveLength(1); // idempotent
  });

  it("sends the on-the-day and +7 reminders as the clock moves", async () => {
    const end = new Date(NOW.getTime() + 7 * 86_400_000 - 3_600_000);
    await new LifecycleService().sendReminders(new Date(end.getTime() + 60_000));
    await new LifecycleService().sendReminders(new Date(end.getTime() + 7 * 86_400_000 + 60_000));
    const subjects = mail.sent.filter((m) => m.to === "renew-soon@lc.test").map((m) => m.subject);
    expect(subjects).toHaveLength(3);
    expect(subjects[1]).toMatch(/ends today/);
    expect(subjects[2]).toMatch(/overdue/);
  });
});
