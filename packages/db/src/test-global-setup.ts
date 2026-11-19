// Vitest globalSetup: one fresh database per suite, named by SMW_TEST_DB, with SMW_TEST_FEATURES pushed.
import { setupTestDatabase } from "./admin";

export default async function setup() {
  const name = process.env.SMW_TEST_DB ?? "default";
  const features = (process.env.SMW_TEST_FEATURES ?? "").split(",").filter(Boolean);
  await setupTestDatabase(name, features);
}
