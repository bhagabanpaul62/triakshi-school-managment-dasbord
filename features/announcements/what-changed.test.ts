import { describe, expect, it } from "vitest";
import { changedSettings } from "./what-changed";

describe("changedSettings", () => {
  const seen = { type: "notice", audience: { include: [{ type: "everyone" }], exclude: [] }, response: { kind: "none" }, dueAt: null, website: false, lang2: null, title2: null, body2: null, expiresAt: "2026-12-01T00:00:00.000Z" };
  it("says nothing when only the words changed", () => {
    expect(changedSettings(seen, { ...seen, title: "New", body: "New", expiresAt: new Date("2026-12-01T00:00:00.000Z") })).toEqual([]);
  });
  it("names each changed setting once, in plain words", () => {
    const now = { ...seen, audience: { include: [{ type: "families" }], exclude: [] }, dueAt: new Date("2026-12-05T00:00:00Z"), response: { kind: "ack" }, lang2: "Hindi", title2: "x", body2: "y" };
    expect(changedSettings(seen, now)).toEqual(["Who it is for", "What people must do", "Answer by", "Second language"]);
  });
});
