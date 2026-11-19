#!/usr/bin/env node
// Scaffold a feature package: node scripts/new-feature.mjs <key> [requires,comma,separated]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [key, requires = ""] = process.argv.slice(2);
if (!key || !/^[a-z][a-z0-9-]*$/.test(key)) { console.error("usage: new-feature.mjs <key> [requires]"); process.exit(1); }
const dir = join(new URL("..", import.meta.url).pathname, "features", key);
if (existsSync(join(dir, "package.json"))) { console.error(`${key} exists`); process.exit(1); }
const reqs = requires.split(",").filter(Boolean);
mkdirSync(join(dir, "ui"), { recursive: true });
const deps = Object.fromEntries([["@smw/db", "workspace:*"], ["@smw/feature-kit", "workspace:*"], ["@smw/runtime", "workspace:*"], ["@smw/ui", "workspace:*"], ["@smw/integrations", "workspace:*"],
  ...reqs.map((r) => [`@smw/feature-${r}`, "workspace:*"]), ["drizzle-orm", "^0.45.4"], ["zod", "^4.6.7"]]);
writeFileSync(join(dir, "package.json"), JSON.stringify({
  name: `@smw/feature-${key}`, version: "0.0.0", private: true, type: "module",
  exports: { "./feature": "./feature.ts", "./schema": "./schema.ts", "./service": "./service.ts", "./seed": "./seed.ts", "./jobs": "./jobs.ts", "./ui/*": "./ui/*.tsx", "./*": "./*.ts" },
  scripts: { typecheck: "tsgo --noEmit", test: "vitest run" },
  dependencies: deps,
  peerDependencies: { next: "^16.4.6", react: "^19.3.1" },
  devDependencies: { "@smw/config": "workspace:*", next: "^16.4.6", react: "^19.3.1", typescript: "^5.9.3" },
}, null, 2) + "\n");
writeFileSync(join(dir, "tsconfig.json"), `{ "extends": "@smw/config/tsconfig/react-library.json", "include": ["**/*.ts", "**/*.tsx"], "exclude": ["node_modules"] }\n`);
writeFileSync(join(dir, "vitest.config.ts"), `import { dbTestConfig } from "@smw/db/vitest-config";\nexport default dbTestConfig(${JSON.stringify(key.replace(/-/g, "_"))}, ${JSON.stringify([...reqs, key])});\n`);
console.log(`created features/${key}. Run pnpm install (or pnpm gen) to link it.`);
