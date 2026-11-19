import { describe, expect, it } from "vitest";
import { resolveEntitlements, type ModuleInfo } from "./resolver";

const mods: ModuleInfo[] = [
  { key: "settings", stage: "ga", requires: [], core: true },
  { key: "billing", stage: "ga", requires: [], core: true },
  { key: "students", stage: "ga", requires: [], core: false },
  { key: "attendance", stage: "ga", requires: ["students"], core: false },
  { key: "transport", stage: "alpha", requires: ["students"], core: false },
];
const base = { modules: mods, planModuleKeys: ["students", "attendance", "transport"], overrides: [] };
const on = (r: { enabled: Set<string> }) => [...r.enabled].sort();

describe("resolveEntitlements", () => {
  it("gives core modules and ga modules in the plan", () => {
    expect(on(resolveEntitlements({ ...base, status: "active" }))).toEqual(["attendance", "billing", "settings", "students"]);
  });
  it("suspended keeps only billing and settings, read-only", () => {
    const r = resolveEntitlements({ ...base, status: "suspended" });
    expect(on(r)).toEqual(["billing", "settings"]);
    expect(r.readOnly).toBe(true);
  });
  it("read_only keeps modules but blocks writes", () => {
    const r = resolveEntitlements({ ...base, status: "read_only" });
    expect(r.enabled.has("students")).toBe(true);
    expect(r.readOnly).toBe(true);
  });
  it("an unexpired override enables an alpha module", () => {
    const r = resolveEntitlements({ ...base, status: "active", overrides: [{ moduleKey: "transport", enabled: true, expiresAt: new Date(Date.now() + 1e6) }] });
    expect(r.enabled.has("transport")).toBe(true);
  });
  it("an expired override is ignored", () => {
    const r = resolveEntitlements({ ...base, status: "active", overrides: [{ moduleKey: "transport", enabled: true, expiresAt: new Date(Date.now() - 1e6) }] });
    expect(r.enabled.has("transport")).toBe(false);
  });
  it("turning off a requirement turns off its dependants", () => {
    const r = resolveEntitlements({ ...base, status: "active", overrides: [{ moduleKey: "students", enabled: false, expiresAt: null }] });
    expect(r.enabled.has("attendance")).toBe(false);
  });
  it("a module outside the plan is off", () => {
    expect(resolveEntitlements({ ...base, status: "active", planModuleKeys: [] }).enabled.has("students")).toBe(false);
  });
});
