import { describe, expect, it } from "vitest";
import { DnsUnavailableError, FakeDnsResolver } from "./dns";
import { FakeTlsProbe, NodeTlsProbe, isPrivateAddress } from "./tls-probe";

describe("TlsProbe", () => {
  it("knows private and loopback addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.9", "172.20.1.1", "169.254.169.254", "0.0.0.0", "::1", "fe80::1", "198.18.0.1", "198.19.255.255", "192.0.0.8", "100.64.0.1", "100.127.255.1", "224.0.0.1", "239.1.1.1", "255.255.255.255", "ff02::1", "fd00::1", "::ffff:10.0.0.1", "::ffff:7f00:1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "203.0.113.10", "172.32.0.1", "198.20.0.1", "100.128.0.1", "192.0.2.1", "2606:4700::1", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("refuses a name that answers with a loopback address, without connecting", async () => {
    const r = await new NodeTlsProbe().probe("localhost");
    expect(r).toMatchObject({ ok: false, error: "The address is not a public one." });
  });
  it("the fake answers per host", async () => {
    const t = new FakeTlsProbe({ "www.a.in": { ok: true, issuer: "Let's Encrypt", expiresAt: new Date(0) } });
    expect((await t.probe("www.a.in")).ok).toBe(true);
    expect((await t.probe("www.b.in")).ok).toBe(false);
  });
});

describe("FakeDnsResolver", () => {
  it("a lookup that cannot be asked throws; a missing record is just empty", async () => {
    const d = new FakeDnsResolver();
    d.down.add("a.in");
    await expect(d.txt("a.in")).rejects.toBeInstanceOf(DnsUnavailableError);
    expect(await d.txt("b.in")).toEqual([]);
  });
  it("answers a and ns, and takes a partial record set", async () => {
    const d = new FakeDnsResolver({ a: { "a.in": ["1.2.3.4"] }, ns: { "a.in": ["ns1.godaddy.com"] } });
    expect(await d.a("a.in")).toEqual(["1.2.3.4"]);
    expect(await d.ns("a.in")).toEqual(["ns1.godaddy.com"]);
    expect(await d.txt("a.in")).toEqual([]);
  });
});
