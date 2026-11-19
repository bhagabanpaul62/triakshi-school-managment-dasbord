import { describe, expect, it } from "vitest";
import { FakeDnsResolver } from "@smw/integrations";
import { DomainVerifier } from "./verifier";

const v = (txt: Record<string, string[]>, cname: Record<string, string[]>) => new DomainVerifier(new FakeDnsResolver({ txt, cname }));

describe("DomainVerifier", () => {
  it("passes with the right TXT and CNAME", async () => {
    const r = await v({ "_smw-verify.www.school.in": ["smw-verify=abc"] }, { "www.school.in": ["sites.yourbrand.com"] }).verify("www.school.in", "abc", "yourbrand.com");
    expect(r).toMatchObject({ txtOk: true, cnameOk: true, ok: true });
  });
  it("ignores case and a trailing dot on the CNAME", async () => {
    const r = await v({ "_smw-verify.www.school.in": ["smw-verify=abc"] }, { "www.school.in": ["Sites.YourBrand.com."] }).verify("www.school.in", "abc", "yourbrand.com");
    expect(r.ok).toBe(true);
  });
  it("fails on a wrong token", async () => {
    const r = await v({ "_smw-verify.www.school.in": ["smw-verify=other"] }, { "www.school.in": ["sites.yourbrand.com"] }).verify("www.school.in", "abc", "yourbrand.com");
    expect(r).toMatchObject({ txtOk: false, cnameOk: true, ok: false });
    expect(r.error).toContain("_smw-verify.www.school.in");
  });
  it("fails when the CNAME is missing or points elsewhere", async () => {
    const txt = { "_smw-verify.www.school.in": ["smw-verify=abc"] };
    expect((await v(txt, {}).verify("www.school.in", "abc", "yourbrand.com"))).toMatchObject({ txtOk: true, cnameOk: false, ok: false });
    expect((await v(txt, { "www.school.in": ["other.example.com"] }).verify("www.school.in", "abc", "yourbrand.com")).ok).toBe(false);
  });
  it("a bare domain needs only the TXT", async () => {
    expect((await v({ "_smw-verify.school.in": ["smw-verify=abc"] }, {}).verify("school.in", "abc", "yourbrand.com")).ok).toBe(true);
    expect((await v({}, {}).verify("school.in", "abc", "yourbrand.com")).ok).toBe(false);
  });
});
