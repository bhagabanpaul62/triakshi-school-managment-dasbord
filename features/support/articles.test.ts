import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AREAS, ARTICLES, articleBySlug } from "./articles";
import { scoreArticle, searchArticles, words } from "./search";
import { ticketRef, stageOf, trackFor, browserName } from "./labels";

const ROOT = resolve(import.meta.dirname, "../..");
const APP = join(ROOT, "apps/school/src/app/app/(panel)");
const FEATURES = join(ROOT, "features");

/** Does `/app/a/b` exist as a page folder under (panel)? A `[param]` folder matches any one segment. */
function pageExists(href: string): boolean {
  const parts = href.replace(/^\/app\/?/, "").split("/").filter(Boolean);
  let dir = APP;
  for (const part of parts) {
    const next = readdirSync(dir).find((d) => statSync(join(dir, d)).isDirectory() && (d === part || /^\[.+\]$/.test(d)));
    if (!next) return false;
    dir = join(dir, next);
  }
  return existsSync(join(dir, "page.tsx"));
}

describe("help articles", () => {
  it("has at least 30, each with steps, links, and a unique slug", () => {
    expect(ARTICLES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ARTICLES.map((a) => a.slug)).size).toBe(ARTICLES.length);
    for (const a of ARTICLES) {
      expect(a.steps.length, a.slug).toBeGreaterThanOrEqual(3);
      expect(a.title.length, a.slug).toBeGreaterThan(8);
      expect(a.summary.length, a.slug).toBeGreaterThan(20);
      expect(a.links.length, a.slug).toBeGreaterThanOrEqual(1);
      expect(a.for.length, a.slug).toBeGreaterThanOrEqual(1);
      expect(AREAS[a.area], a.slug).toBeTruthy();
      expect(a.slug).toMatch(/^[a-z0-9-]{1,80}$/);
    }
  });

  it("every link is a page of the school app", () => {
    for (const a of ARTICLES) for (const l of a.links) expect(pageExists(l.href), `${a.slug}: ${l.href}`).toBe(true);
  });

  it("every 'related' article exists and none points at itself", () => {
    for (const a of ARTICLES) for (const r of a.related) { expect(articleBySlug(r), `${a.slug} -> ${r}`).toBeTruthy(); expect(r).not.toBe(a.slug); }
  });

  it("covers every module of the product, and the journeys schools ask about most", () => {
    const text = JSON.stringify(ARTICLES).toLowerCase();
    const modules = readdirSync(FEATURES).filter((d) => existsSync(join(FEATURES, d, "feature.ts")));
    // each module is named by what its menu says, or by the words a school uses for it
    const words: Record<string, string[]> = {
      academics: ["classes", "academic years"], announcements: ["notice"], assignments: ["homework"], attendance: ["attendance"], billing: ["billing"],
      domains: ["domain"], events: ["calendar"], exams: ["exams"], expenses: ["expenses"], fees: ["fees"], finance: ["finance"], home: [], library: ["library"],
      meetings: ["meetings"], messages: ["messages"], notifications: ["bell"], payroll: ["payroll"], requests: ["requests"], settings: ["settings"], setup: ["first week"],
      staff: ["staff"], students: ["students"], support: ["support"], timetable: ["timetable"], transport: ["transport"], website: ["website"],
    };
    for (const m of modules) {
      if (m === "home") continue; // the home page has no menu entry of its own
      expect(words[m], `no words for module ${m}`).toBeTruthy();
      for (const w of words[m]!) expect(text, `module ${m}: ${w}`).toContain(w);
    }
    const asked = ["login slips", "reset a password", "take a fee", "reverse", "mark attendance", "publish results", "send a notice", "add a domain", "publish", "export"];
    for (const q of asked) expect(searchArticles(q).length, q).toBeGreaterThan(0);
  });

  it("does not use an em dash or a placeholder", () => {
    const text = JSON.stringify(ARTICLES);
    expect(text).not.toContain("—");
    expect(text.toLowerCase()).not.toMatch(/coming soon|lorem|todo/);
  });
});

/** Every word the product shows on screen: menu labels, page and panel titles, button labels, found in the code. */
function screenWords(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const d of readdirSync(dir)) {
      if (d === "node_modules" || d.startsWith(".")) continue;
      const p = join(dir, d);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(d) || /\.test\./.test(d)) continue;
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/(?:title|label|eyebrow|placeholder)\s*[:=]\s*\{?\s*["'`]([^"'`$]{2,80})["'`]/g)) out.add(m[1]!.trim());
      for (const m of src.matchAll(/>\s*([A-Z][^<>{}]{2,60}?)\s*</g)) out.add(m[1]!.trim());
      for (const m of src.matchAll(/["']([A-Z][A-Za-z' ,.…-]{2,50})["']/g)) out.add(m[1]!.trim());
    }
  };
  walk(FEATURES);
  walk(join(ROOT, "apps/school/src/app/app"));
  return out;
}

describe("help articles name real screens", () => {
  it("every **bold** word an article tells a person to click or open is on a screen of the product", () => {
    const words = screenWords();
    const missing: string[] = [];
    for (const a of ARTICLES) for (const t of [...a.steps, ...(a.notes ?? [])]) for (const m of t.matchAll(/\*\*(.+?)\*\*/g)) if (!words.has(m[1]!)) missing.push(`${a.slug}: ${m[1]}`);
    expect(missing).toEqual([]);
  });
  it("covers the newer rooms: website tabs, disclosure, versions, schedule, enquiries desk, domain page, settings pages, sign-ins, exports, privacy, support access, getting started", () => {
    const text = JSON.stringify(ARTICLES).toLowerCase();
    for (const w of ["pages and menu", "disclosure", "bring back as draft", "schedule", "take this enquiry", "enquiry reports", "the records, one by one", "settings", "sign-in activity", "export your data", "privacy requests", "support access", "getting started"]) expect(text, w).toContain(w);
    for (const h of ["/app/website/versions", "/app/website/disclosure", "/app/enquiries/reports", "/app/settings/access", "/app/settings/sign-ins", "/app/settings/privacy", "/app/getting-started"]) expect(ARTICLES.some((a) => a.links.some((l) => l.href === h)), h).toBe(true);
  });
});

describe("help search", () => {
  const top = (q: string) => searchArticles(q)[0]?.slug;
  it("puts the right article first for what schools actually type", () => {
    expect(top("how do I take a fee")).toBe("take-a-fee");
    expect(top("reverse a receipt")).toBe("reverse-a-receipt");
    expect(top("login slip")).toBe("login-slips");
    expect(top("forgot password")).toBe("reset-password");
    expect(top("publish results")).toBe("publish-results");
    expect(top("add my own domain")).toBe("add-a-domain");
    expect(top("mark attendance")).toBe("mark-attendance");
    expect(top("send a notice")).toBe("send-a-notice");
    expect(top("export data")).toBe("export-your-data");
    expect(top("student cannot sign in")).toBe("cannot-sign-in");
    expect(top("upi paid but not showing")).toBe("family-says-paid-by-upi");
  });
  it("handles plurals and typed case, and finds nothing for nonsense", () => {
    expect(top("RECEIPTS")).toBeTruthy();
    expect(searchArticles("zzzqqq xxyyww")).toEqual([]);
    expect(searchArticles("   ")).toHaveLength(ARTICLES.length);
    expect(scoreArticle(ARTICLES[0]!, "")).toBe(0);
    expect(words("The Fees are due")).toEqual(["fee", "due"]);
  });
  it("filters by area and by who it is for, and limits", () => {
    expect(searchArticles("", { area: "fees" }).every((a) => a.area === "fees")).toBe(true);
    expect(searchArticles("", { audience: "teacher" }).every((a) => a.for.includes("teacher") || a.for.includes("everyone"))).toBe(true);
    expect(searchArticles("fee", { limit: 2 })).toHaveLength(2);
  });
});

describe("ticket words", () => {
  it("numbers and stages", () => {
    expect(ticketRef(1042)).toBe("T-1042");
    const base = { createdAt: new Date("2026-11-23T04:30:00Z") };
    expect(stageOf({ status: "open" })).toBe(0);
    expect(stageOf({ status: "open", firstReplyAt: new Date() })).toBe(1);
    expect(stageOf({ status: "pending" })).toBe(2);
    expect(stageOf({ status: "resolved" })).toBe(3);
    expect(stageOf({ status: "closed" })).toBe(4);
    expect(trackFor({ ...base, status: "pending" }).map((s) => s.state)).toEqual(["done", "done", "now", "todo", "todo"]);
    expect(trackFor({ ...base, status: "closed" }).map((s) => s.state)).toEqual(["done", "done", "done", "done", "now"]);
  });
  it("names a browser without showing the raw string", () => {
    expect(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(browserName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1")).toBe("Safari on iPhone or iPad");
    expect(browserName(null)).toBeUndefined();
  });
});
