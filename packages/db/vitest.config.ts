import { defineConfig } from "vitest/config";

// The migration test builds its own throwaway database, so no globalSetup here.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], fileParallelism: false, testTimeout: 120_000, hookTimeout: 120_000 } });
