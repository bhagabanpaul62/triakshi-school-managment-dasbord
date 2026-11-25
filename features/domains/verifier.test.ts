import { describe, expect, it } from "vitest";
import { FakeDnsResolver, FakeTlsProbe } from "@smw/integrations";
import { DomainVerifier } from "./verifier";

const IP = "203.0.113.10";
const cert = { ok: true, issuer: "Let's Encrypt", expiresAt: new Date("2027-02-01T00:00:00Z") };
const v = (r: ConstructorParameters<typeof FakeDnsResolver>[0], tls: ConstructorParameters<typeof FakeTlsProbe>[0] = {}) => new DomainVerifier(new FakeDnsResolver(r), new FakeTlsProbe(tls), IP);
const key = (r: { records: { key: string; ok: boolean }[] }) => Object.fromEntries(r.records.map((x) => [x.key, x.ok]));

describe("DomainVerifier", () => {
  it("passes with the right TXT and CNAME, and reads the certificate", async () => {
    const r = await v({ txt: { "_smw-verify.www.school.in": ["smw-verify=abc"] }, cname: { "www.school.in": ["sites.yourbrand.com"] } }, { "www.school.in": cert }).verify("www.school.in", "abc", "yourbrand.com");
    expect(r).toMatchObject({ txtOk: true, pointsOk: true, httpsOk: true, ok: true });
    expect(key(r)).toEqual({ txt: true, cname: true, https: true });
    expect(r.records[2]!.found).toEqual(["Let's Encrypt", "expires 2027-02-01"]);
    expect(r.certExpiresAt).toEqual(cert.expiresAt);
  });
  it("gives each record on its own: expected next to found", async () => {
    const r = await v({ txt: { "_smw-verify.www.school.in": ["smw-verify=other", "v=spf1 -all"] }, cname: { "www.school.in": ["old.host.com"] } }).verify("www.school.in", "abc", "yourbrand.com");
    expect(r.records[0]).toMatchObject({ key: "txt", ok: false, expected: "smw-verify=abc", found: ["smw-verify=other"] });
    expect(r.records[1]).toMatchObject({ key: "cname", ok: false, expected: "sites.yourbrand.com", found: ["old.host.com"] });
    expect(r.records[2]).toMatchObject({ key: "https", ok: false, note: "Checked once the address points to us." });
    expect(r.error).toContain("_smw-verify.www.school.in");
  });
  it("ignores case and a trailing dot on the CNAME", async () => {
    const r = await v({ txt: { "_smw-verify.www.school.in": ["smw-verify=abc"] }, cname: { "www.school.in": ["Sites.YourBrand.com."] } }).verify("www.school.in", "abc", "yourbrand.com");
    expect(r.ok).toBe(true);
  });
  it("a name flattened to our address counts as pointing at us", async () => {
    const r = await v({ txt: { "_smw-verify.www.school.in": ["smw-verify=abc"] }, a: { "www.school.in": [IP] } }).verify("www.school.in", "abc", "yourbrand.com");
    expect(r.pointsOk).toBe(true);
  });
  it("D5: a bare domain needs the A record as well as the TXT", async () => {
    const txt = { "_smw-verify.school.in": ["smw-verify=abc"] };
    const only = await v({ txt }).verify("school.in", "abc", "yourbrand.com");
    expect(only).toMatchObject({ txtOk: true, pointsOk: false, ok: false });
    expect(only.error).toContain(IP);
    expect(key(only)).toEqual({ txt: true, a: false, https: false });
    const elsewhere = await v({ txt, a: { "school.in": ["198.51.100.7"] } }).verify("school.in", "abc", "yourbrand.com");
    expect(elsewhere.ok).toBe(false);
    expect(elsewhere.records[1]!.found).toEqual(["198.51.100.7"]);
    expect((await v({ txt, a: { "school.in": [IP] } }).verify("school.in", "abc", "yourbrand.com")).ok).toBe(true);
    expect((await v({}).verify("school.in", "abc", "yourbrand.com")).ok).toBe(false);
  });
  it("does not probe HTTPS when the host does not point at us", async () => {
    const r = await v({ txt: { "_smw-verify.www.school.in": ["smw-verify=abc"] } }, { "www.school.in": cert }).verify("www.school.in", "abc", "yourbrand.com");
    expect(r.httpsOk).toBe(false);
    expect(r.certExpiresAt).toBeNull();
  });
  it("tells the DNS provider from the name servers", async () => {
    const r = await v({ ns: { "www.school.in": ["ns1.domaincontrol.com"] } }).verify("www.school.in", "abc", "yourbrand.com");
    expect(r.provider).toBe("godaddy");
  });
});
