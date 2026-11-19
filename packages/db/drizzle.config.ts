import { defineConfig } from "drizzle-kit";
import { env } from "@smw/config";

// DRIZZLE_FEATURES (comma list) limits which features/*/schema.ts files are included: used by per-suite test databases.
const only = process.env.DRIZZLE_FEATURES?.split(",").filter(Boolean);
const features = only ? only.filter((f) => f !== "__none__").map((f) => `../../features/${f}/schema.ts`) : ["../../features/*/schema.ts"];

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema/*.ts", ...features],
  out: "./migrations",
  dbCredentials: { url: process.env.DRIZZLE_URL ?? env().DATABASE_URL_MIGRATE },
  entities: { roles: false },
  strict: false,
});
