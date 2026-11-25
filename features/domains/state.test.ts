import { describe, expect, it } from "vitest";
import { domainState, redirectSentence } from "./state";
import type { SchoolDomain } from "./monitor";

const d = (o: Partial<SchoolDomain>) => ({ status: "verified", health: "ok", verifiedAt: new Date(), checkError: null, isPrimary: false, txtMissingSince: null, certExpiresAt: new Date(Date.now() + 40 * 86_400_000), records: [{ key: "https", ok: true, expected: "x", found: [] }], ...o }) as SchoolDomain;

describe("domainState", () => {
  it("names every state and the next step", () => {
    expect(domainState(d({ status: "pending", health: null, verifiedAt: null }))).toMatchObject({ label: "Waiting for DNS", next: "finish" });
    expect(domainState(d({ status: "failed", health: null, verifiedAt: null, checkError: "Nope." }))).toMatchObject({ label: "Not verified", next: "retry" });
    expect(domainState(d({ status: "failed", health: null, checkError: "Gone for 14 days." }))).toMatchObject({ label: "Stopped", next: "retry" });
    expect(domainState(d({ health: "broken" }))).toMatchObject({ tone: "danger", next: "fix" });
    expect(domainState(d({ health: "warning" }))).toMatchObject({ tone: "warning", next: "fix" });
    expect(domainState(d({ health: "warning", certExpiresAt: null, records: [] }))).toMatchObject({ label: "Getting the secure certificate", next: "retry" });
    expect(domainState(d({ health: "warning", txtMissingSince: new Date("2026-06-01T00:00:00Z") })).sentence).toContain("released on 15 Jun");
    expect(domainState(d({}))).toMatchObject({ label: "Live", next: "main" });
    expect(domainState(d({ isPrimary: true }))).toMatchObject({ label: "Live", next: "none" });
    expect(domainState(d({ health: null }))).toMatchObject({ label: "Live" });
  });
});

describe("redirectSentence (D2)", () => {
  const main = d({ hostname: "www.school.in", isPrimary: true } as Partial<SchoolDomain>);
  it("says which addresses go where", () => {
    expect(redirectSentence({ free: "gv.x.in", main, others: ["school.in", "gv.x.in"], on: true })).toBe("school.in and gv.x.in send visitors to www.school.in. The panel and sign-in stay where they are.");
    expect(redirectSentence({ free: "gv.x.in", main, others: ["gv.x.in"], on: true })).toContain("gv.x.in send visitors to www.school.in");
  });
  it("says so when it is off, when there is no main domain and when the main one is broken", () => {
    expect(redirectSentence({ free: "gv.x.in", main, others: ["gv.x.in"], on: false })).toContain("is off");
    expect(redirectSentence({ free: "gv.x.in", main: null, others: [], on: true })).toContain("make it your main domain");
    expect(redirectSentence({ free: "gv.x.in", main: { ...main, health: "broken" }, others: [], on: true })).toContain("stay on gv.x.in until it is fixed");
  });
});
