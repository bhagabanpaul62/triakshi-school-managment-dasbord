import { describe, expect, it } from "vitest";
import { isPlainHostname, tlsAllowed } from "./tls";

describe("tlsAllowed", () => {
  it("allows schools that can still be reached", () => {
    for (const status of ["active", "trial", "past_due", "read_only"] as const) expect(tlsAllowed("www.school.in", { status }), status).toBe(true);
  });
  it("refuses suspended, cancelled and unknown hosts", () => {
    expect(tlsAllowed("www.school.in", { status: "suspended" })).toBe(false);
    expect(tlsAllowed("www.school.in", { status: "cancelled" })).toBe(false);
    expect(tlsAllowed("www.school.in", null)).toBe(false);
  });
  it("refuses hosts that are not plain hostnames, even for a live school", () => {
    for (const bad of ["", "%.school.in", "a_b.school.in", "school.in/x", "-x.school.in", "1.2.3.4"]) {
      expect(isPlainHostname(bad), bad).toBe(false);
      expect(tlsAllowed(bad, { status: "active" }), bad).toBe(false);
    }
  });
  it("accepts dev hosts", () => expect(isPlainHostname("a.localhost")).toBe(true));
});
