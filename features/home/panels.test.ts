import { describe, expect, it } from "vitest";
import type { Ctx } from "@smw/feature-kit";
import { FEATURES } from "./staff-links";
import { readFileSync } from "node:fs";
import { PANELS, holds, layoutOf, pageNeeds, panelAllowed, panelsFor, type PanelKey } from "./panels";

const ALL = new Set(FEATURES.map((f) => f.key).concat("home"));
const who = (role: Ctx["role"], grants?: string[], extra: Partial<Ctx> = {}) => ({ role, features: ALL as ReadonlySet<string>, grants: grants ? new Set(grants) : undefined, supportStaffId: null, ...extra });
const keys = (c: ReturnType<typeof who>) => panelsFor(c).map((p) => p.key);

describe("panels per login, in their fixed order", () => {
  const cases: [string, ReturnType<typeof who>, PanelKey[]][] = [
    ["admin", who("admin"), ["today", "getting-started", "numbers", "needs-action", "attention", "requests", "approvals", "attendance-week", "money-trend", "funnel", "plan", "leave", "birthdays", "notices", "events"]],
    ["accountant", who("accountant"), ["fin-numbers", "needs-action", "my-approvals", "requests", "dues-by-class", "overdue", "receipts", "cheques", "payroll", "notices", "my-setup"]],
    ["teacher", who("teacher"), ["now-next", "to-mark", "to-grade", "marks", "homework", "my-class", "meetings", "needs-action", "messages", "notices", "my-setup"]],
    ["student (family)", who("student"), ["family-answer", "family-classes", "family-homework", "family-dues", "family-attendance", "family-exam", "family-result", "family-meeting", "family-bus", "family-library", "notices"]],
    ["cashier", who("staff", ["home:view", "fees:read", "fees:collect", "students:read", "attendance:leave", "expenses:claim", "announcements:read", "notifications:read"]), ["needs-action", "fin-numbers", "my-approvals", "dues-by-class", "overdue", "receipts", "cheques", "notices", "links"]],
    ["bursar", who("staff", ["home:view", "finance:read", "finance:approve", "finance:close", "fees:read", "expenses:read", "payroll:read", "announcements:read", "notifications:read"]), ["needs-action", "fin-numbers", "approvals", "dues-by-class", "overdue", "receipts", "payroll", "notices", "links"]],
    ["auditor", who("staff", ["home:view", "finance:read", "fees:read", "expenses:read", "payroll:read"]), ["fin-numbers", "dues-by-class", "overdue", "receipts", "payroll", "links"]],
    ["librarian", who("teacher", ["home:view", "library:read", "library:manage", "announcements:read"]), ["library", "notices", "links"]],
    ["front office", who("staff", ["home:view", "website:enquiries", "requests:use", "students:read", "announcements:read"]), ["front-office", "requests", "notices", "links"]],
    ["transport in-charge", who("staff", ["home:view", "transport:read", "transport:manage"]), ["transport", "links"]],
    ["exam coordinator", who("staff", ["home:view", "exams:read", "exams:manage"]), ["exam-coordinator", "links"]],
    ["timetable cover", who("staff", ["home:view", "timetable:read", "timetable:manage"]), ["now-next", "cover", "links"]],
    ["website editor", who("staff", ["home:view", "website:read", "website:manage"]), ["website", "links"]],
    ["safeguarding lead only", who("staff", ["home:view", "messages:safeguard"]), ["safeguarding", "links"]],
    ["a role with only home:view", who("staff", ["home:view"]), ["links"]],
    ["teacher base with a library grant (H2)", who("teacher", ["home:view", "timetable:read", "attendance:mark", "meetings:use", "library:read"]), ["now-next", "meetings", "library", "links"]],
  ];
  it.each(cases)("%s", (_name, ctx, want) => { expect(keys(ctx)).toEqual(want); });

  it("every panel shown is one the login holds the needs of, for every case above", () => {
    for (const [, ctx] of cases) for (const p of panelsFor(ctx)) for (const need of p.needs) expect(holds(ctx, need), `${p.key} needs ${need}`).toBe(true);
  });

  it("no panel without permission: take one grant away and the panel that needs it goes", () => {
    const all = ["home:view", "fees:read", "fees:collect", "finance:approve", "payroll:read", "library:read", "transport:read", "exams:read", "exams:manage", "timetable:manage", "website:read", "website:manage", "website:enquiries", "messages:safeguard", "announcements:read", "notifications:read", "requests:use"];
    expect(keys(who("staff", all))).toEqual(expect.arrayContaining(["cheques", "approvals", "payroll", "library", "transport", "exam-coordinator", "cover", "website", "front-office", "safeguarding", "requests"]));
    for (const g of all.filter((x) => x !== "home:view")) {
      const left = who("staff", all.filter((x) => x !== g));
      for (const p of panelsFor(left)) expect(p.needs.every((n) => n !== g), `${p.key} still shown without ${g}`).toBe(true);
    }
  });

  it("a module that is off takes its panels away", () => {
    const off = who("admin", undefined, { features: new Set([...ALL].filter((f) => f !== "fees" && f !== "attendance")) });
    expect(keys(off)).not.toContain("money-trend");
    expect(keys(off)).not.toContain("attendance-week");
    expect(keys(off)).toContain("numbers"); // it shows the numbers of the modules that are on
  });

  it("a support session never gets a panel that shows names, children or messages", () => {
    const support = (c: ReturnType<typeof who>) => ({ ...c, supportStaffId: "11111111-1111-1111-1111-111111111111" });
    const privateKeys = Object.values(PANELS).filter((p) => p.private).map((p) => p.key);
    expect(privateKeys).toEqual(expect.arrayContaining(["overdue", "receipts", "approvals", "my-approvals", "birthdays", "needs-action", "leave", "my-class", "messages", "front-office", "safeguarding", "my-setup", "family-answer", "family-meeting"]));
    for (const ctx of [who("admin"), who("accountant"), who("teacher"), who("student"), who("staff", ["home:view", "website:enquiries", "messages:safeguard"])]) {
      const shown = keys(support(ctx));
      for (const k of privateKeys) expect(shown, `${k} in a support session`).not.toContain(k);
      for (const k of privateKeys) expect(panelAllowed(support(ctx), k)).toBe(false);
    }
    expect(keys(support(who("admin")))).toEqual(expect.arrayContaining(["today", "numbers", "attention"])); // the school's numbers are visible to support
  });

  it("a role with grants gets the teacher's panels only for what its grants allow", () => {
    expect(layoutOf(who("teacher", ["home:view"]))).toEqual(expect.arrayContaining(["now-next", "library"])); // candidates
    expect(keys(who("teacher", ["home:view"]))).toEqual(["links"]);
  });
});

describe("work panels follow the grants, not the base role (item 3)", () => {
  it("a staff-base role with period, register, marks and grading grants gets those panels", () => {
    const grants = ["home:view", "timetable:read", "attendance:mark", "attendance:read", "exams:read", "exams:marks", "assignments:read", "meetings:use", "messages:use", "students:read"];
    expect(keys(who("staff", grants))).toEqual(["now-next", "to-mark", "to-grade", "marks", "homework", "my-class", "meetings", "messages", "links"]);
  });
  it("an approver does not get 'waiting for approval'; an auditor, who submits nothing, does not either; a cashier does", () => {
    expect(keys(who("staff", ["home:view", "fees:read", "fees:collect", "finance:approve"]))).not.toContain("my-approvals");
    expect(keys(who("staff", ["home:view", "fees:read", "finance:read"]))).not.toContain("my-approvals");
    expect(keys(who("staff", ["home:view", "fees:read", "fees:collect"]))).toContain("my-approvals");
  });
});

describe("links go only to pages the person can open (item 6)", () => {
  const holder = (k: PanelKey) => (PANELS[k].needs.length ? who("staff", ["home:view", ...PANELS[k].needs]) : who("admin"));
  it("every page a panel links to opens with what that panel needs", () => {
    for (const p of Object.values(PANELS)) for (const link of p.links) {
      const opens = pageNeeds(link);
      expect(opens.length, `${p.key} links to ${link}, a page the registry does not know`).toBeGreaterThan(0);
      expect(opens.some((n) => holds(holder(p.key), n)), `${p.key} -> ${link} needs one of ${opens.join(", ")}`).toBe(true);
    }
  });
  it("every /app page named in the views and the service is a page the registry knows", () => {
    const text = ["ui/views.tsx", "ui/parts.tsx", "ui/home-page.tsx", "home-service.ts"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
    const paths = [...new Set([...text.matchAll(/"(\/app\/[a-z0-9-]+(?:\/[a-z0-9-]+)*)/g)].map((m) => m[1]!))];
    expect(paths.length).toBeGreaterThan(20);
    for (const path of paths) expect(pageNeeds(path).length, `${path} is not a page the registry knows`).toBeGreaterThan(0);
  });
});
