import { describe, expect, it } from "vitest";
import { primaryRedirect } from "./primary";

const base = { host: "greenvalley.example.in", freeHost: "greenvalley.example.in", primaryHost: "www.school.in", redirect: true, path: "/about?x=1" };

describe("primaryRedirect", () => {
  it("sends the free address to the main domain with path and query, permanently", () => {
    expect(primaryRedirect(base)).toEqual({ status: 308, location: "https://www.school.in/about?x=1" });
  });
  it("sends the bare domain on to www (D2)", () => {
    expect(primaryRedirect({ ...base, host: "school.in", path: "/" })).toEqual({ status: 308, location: "https://www.school.in/" });
  });
  it("serves the main domain itself, ignoring case and port", () => {
    expect(primaryRedirect({ ...base, host: "WWW.School.in:443" })).toBeNull();
  });
  it("never moves the panel, sign-in or api, whatever the case of the host", () => {
    for (const path of ["/app", "/app/students?x=1", "/login", "/login?next=/app", "/api/v1/x", "/_next/static/a.js"]) expect(primaryRedirect({ ...base, path }), path).toBeNull();
  });
  it("does not mistake a page that starts with the same letters", () => {
    expect(primaryRedirect({ ...base, path: "/application-form" })?.location).toBe("https://www.school.in/application-form");
  });
  it("stays put when there is no healthy main domain or the switch is off", () => {
    expect(primaryRedirect({ ...base, primaryHost: null })).toBeNull();
    expect(primaryRedirect({ ...base, redirect: false })).toBeNull();
    expect(primaryRedirect({ ...base, primaryHost: base.freeHost })).toBeNull();
  });
});
