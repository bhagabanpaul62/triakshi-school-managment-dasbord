import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

// react-dom is not a dependency of this package (the app renders it); borrow the UI package's copy for render tests.
const fromUi = createRequire(new URL("../ui/package.json", import.meta.url));
export default defineConfig({ resolve: { alias: { "react-dom/server": fromUi.resolve("react-dom/server") } } });
