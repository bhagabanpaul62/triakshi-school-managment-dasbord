import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import notificationsFeature from "@smw/feature-notifications/feature";
import eventsFeature from "./feature";
import { eventPeople, events } from "./schema";
import seed from "./seed";
import { asUser, FEATURES, fixture } from "./test-fixture";

let a: TestSchool;
beforeAll(async () => {
  await registerFeatures([eventsFeature, notificationsFeature]);
  ({ a } = await createSchoolPair(FEATURES, "s"));
  const fx = await fixture(a);
  await seed(asUser(a, a.users.admin, "admin"), { students: [{ id: fx.ann, name: "Ann", userId: fx.annUser }, { id: fx.bob, name: "Bob", userId: fx.bobUser }, { id: fx.cy, name: "Cy", userId: fx.cyUser }] });
});
afterAll(closeDb);

describe("demo events", () => {
  it("a year of events: a weekly series with one cancelled day, a trip without a consent link, a cancelled event, a draft", async () => {
    const all = await withSchool(a.id, (tx) => tx.select().from(events));
    expect(all.length).toBeGreaterThan(20);
    const series = all.filter((e) => e.title === "Football practice");
    expect(series).toHaveLength(12);
    expect(series.filter((e) => e.state === "cancelled")).toHaveLength(1);
    expect(all.find((e) => e.type === "trip")).toMatchObject({ consentHref: null, state: "live" });
    expect(all.find((e) => e.title === "Inter-school debate")).toMatchObject({ state: "cancelled" });
    expect(all.find((e) => e.state === "draft")).toBeTruthy();
    expect(all.some((e) => e.isPublic)).toBe(true);
  });

  it("families have answered, and the answers are on the events that ask", async () => {
    const answered = await withSchool(a.id, (tx) => tx.select().from(eventPeople));
    expect(answered.filter((p) => p.answer === "yes").length).toBeGreaterThan(3);
    const exhibition = (await withSchool(a.id, (tx) => tx.select().from(events).where(eq(events.title, "Science Exhibition"))))[0]!;
    expect(exhibition.rsvp.on).toBe(true);
  });
});
