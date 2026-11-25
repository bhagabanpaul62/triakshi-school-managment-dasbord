import { describe, expect, it } from "vitest";
import { GUIDES, detectProvider, itNote } from "./providers";

describe("detectProvider", () => {
  it("knows the registrars schools use from their name servers", () => {
    expect(detectProvider(["ns57.domaincontrol.com", "ns58.domaincontrol.com"])).toBe("godaddy");
    expect(detectProvider(["ns1.dns-parking.com"])).toBe("hostinger");
    expect(detectProvider(["ns1.bigrock.in."])).toBe("bigrock");
    expect(detectProvider(["dns1.registrar-servers.com"])).toBe("namecheap");
    expect(detectProvider(["ada.ns.cloudflare.com"])).toBe("cloudflare");
    expect(detectProvider(["ns1.somewhere.net"])).toBe("other");
    expect(detectProvider([])).toBe("other");
  });
  it("only Cloudflare carries the proxy warning", () => {
    expect(GUIDES.cloudflare.warning).toMatch(/proxy/i);
    expect(Object.entries(GUIDES).filter(([, g]) => g.warning).map(([k]) => k)).toEqual(["cloudflare"]);
  });
  it("the IT note carries every record in the short form", () => {
    const n = itNote({ school: "Green Valley", hostname: "www.gv.in", provider: "cloudflare", records: [{ type: "CNAME", short: "www", name: "www.gv.in", value: "sites.x.com" }] });
    expect(n.subject).toContain("www.gv.in");
    expect(n.body).toContain("name: www");
    expect(n.body).toContain("sites.x.com");
    expect(n.body).toContain("proxy off");
    expect(n.body).not.toMatch(/—/);
  });
});
