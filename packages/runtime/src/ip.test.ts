import { describe, expect, it } from "vitest";
import { trustedClientIp } from "./ip";

const h = (v?: string) => ({ get: (k: string) => (k === "x-forwarded-for" ? v ?? null : null) });
describe("trustedClientIp", () => {
  it("ignores what the visitor wrote and takes the address our proxy saw", () => {
    expect(trustedClientIp(h("203.0.113.9"))).toBe("203.0.113.9");
    expect(trustedClientIp(h("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
    expect(trustedClientIp(h("1.1.1.1, 6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
  });
  it("counts hops from the right when more than one proxy is ours", () => {
    expect(trustedClientIp(h("6.6.6.6, 203.0.113.9, 10.0.0.2"), 2)).toBe("203.0.113.9");
    expect(trustedClientIp(h("203.0.113.9"), 3)).toBe("203.0.113.9");
  });
  it("is undefined with no header", () => { expect(trustedClientIp(h())).toBeUndefined(); });
});
