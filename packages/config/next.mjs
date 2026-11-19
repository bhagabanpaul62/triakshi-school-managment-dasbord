// Shared Next.js settings for marketing, console and school. Workspace packages ship TypeScript source, so Next transpiles them.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceNames = ["packages", "features"].flatMap((dir) =>
  readdirSync(join(repo, dir)).map((d) => join(repo, dir, d, "package.json")).filter(existsSync).map((p) => JSON.parse(readFileSync(p, "utf8")).name),
);

// Load the repo-root .env.local once so every app reads the same settings.
for (const f of [".env.local", ".env"]) {
  const p = join(repo, f);
  if (existsSync(p) && !process.env.DATABASE_URL_SCHOOL) { process.loadEnvFile(p); break; }
}

/** @param {import('next').NextConfig} config */
export function withSmw(config = {}) {
  return {
    output: "standalone",
    outputFileTracingRoot: repo,
    poweredByHeader: false,
    transpilePackages: workspaceNames,
    serverExternalPackages: ["pg-boss", "postgres"],
    ...config,
    experimental: { serverActions: { bodySizeLimit: "16mb" }, ...config.experimental },
  };
}
