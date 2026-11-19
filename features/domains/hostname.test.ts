import { describe, expect, it } from "vitest";
import { checkHostname, dnsInstructions, isApex } from "./hostname";

const ok = (s: string) => { const r = checkHostname(s, "yourbrand.com"); return r.ok ? r.hostname : null; };

describe("checkHostname", () => {
  it("accepts and lower-cases real hostnames", () => {
    expect(ok(" WWW.MySchool.in ")).toBe("www.myschool.in");
    expect(ok("school.co.in")).toBe("school.co.in");
    expect(ok("a-b.school.in.")).toBe("a-b.school.in");
  });
  it("rejects scheme, path, port, spaces", () => {
    for (const bad of ["https://www.school.in", "www.school.in/page", "www.school.in:8080", "www school.in", "a@school.in", "www.school.in?x=1"]) expect(ok(bad), bad).toBeNull();
  });
  it("rejects malformed names", () => {
    for (const bad of ["", "localhost", "school", "-bad.school.in", "bad-.school.in", "a..school.in", "school.123", "192.168.1.1", `${"a".repeat(64)}.school.in`, "sch_ool.in"]) expect(ok(bad), bad).toBeNull();
  });
  it("rejects our own root domain and anything under it", () => {
    expect(ok("yourbrand.com")).toBeNull();
    expect(ok("greenfield.yourbrand.com")).toBeNull();
    expect(ok("notyourbrand.com")).toBe("notyourbrand.com");
    expect(ok("evilyourbrand.com")).toBe("evilyourbrand.com");
  });
});

describe("isApex and DNS instructions", () => {
  it("knows bare domains", () => {
    expect(isApex("school.in")).toBe(true);
    expect(isApex("school.co.in")).toBe(true);
    expect(isApex("www.school.in")).toBe(false);
    expect(isApex("www.school.co.in")).toBe(false);
  });
  it("a subdomain gets TXT and CNAME", () => {
    const i = dnsInstructions({ hostname: "www.school.in", verifyToken: "tok" }, "yourbrand.com", "203.0.113.10");
    expect(i.records).toEqual([
      { type: "TXT", name: "_smw-verify.www.school.in", value: "smw-verify=tok" },
      { type: "CNAME", name: "www.school.in", value: "sites.yourbrand.com" },
    ]);
    expect(i.apex).toBe(false);
  });
  it("a bare domain gets TXT and A, plus a note about www", () => {
    const i = dnsInstructions({ hostname: "school.in", verifyToken: "tok" }, "yourbrand.com", "1.2.3.4");
    expect(i.records.map((r) => r.type)).toEqual(["TXT", "A"]);
    expect(i.records[1]!.value).toBe("1.2.3.4");
    expect(i.notes.join(" ")).toContain("www.school.in");
  });
});
