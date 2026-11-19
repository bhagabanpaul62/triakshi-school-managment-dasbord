import { defineConfig } from "vitest/config";

/**
 * Vitest config for a package or feature whose tests touch Postgres.
 *   export default dbTestConfig("students", ["academics", "students"]);
 * Platform tables are always included; list the features whose tables the tests need.
 */
export function dbTestConfig(name: string, features: string[] = []) {
  process.env.SMW_TEST_DB = name;
  process.env.SMW_TEST_FEATURES = features.join(",");
  return defineConfig({
    test: {
      globalSetup: [new URL("./test-global-setup.ts", import.meta.url).pathname],
      fileParallelism: false,
      testTimeout: 20_000,
      hookTimeout: 60_000,
    },
  });
}
