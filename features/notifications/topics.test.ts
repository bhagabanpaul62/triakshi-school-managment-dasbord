import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TOPICS } from "./topics";

const ROOT = join(import.meta.dirname, "../..");
const SKIP = new Set(["node_modules", ".next", "generated", "fixtures"]);
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  SKIP.has(e.name) ? [] : e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);

const sources = [...readdirSync(join(ROOT, "features"), { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => walk(join(ROOT, "features", d.name))), ...walk(join(ROOT, "apps/school/src"))]
  .map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, "utf8") }));

describe("topics", () => {
  it("every topic a feature sends is in TOPICS", () => {
    const unknown = sources.flatMap(({ file, text }) => [...text.matchAll(/\btopic:\s*"([^"]+)"/g)].filter((m) => !(m[1]! in TOPICS)).map((m) => `${file}: ${m[1]}`));
    expect(unknown).toEqual([]);
  });

  it("every topic is sent by some feature", () => {
    const others = sources.filter((s) => !s.file.startsWith("features/notifications/") || s.file.endsWith("jobs.ts"));
    const unused = Object.keys(TOPICS).filter((t) => !others.some((s) => s.text.includes(`"${t}"`)));
    expect(unused).toEqual([]);
  });
});
