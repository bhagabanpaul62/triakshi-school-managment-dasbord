// One flat config for the whole repo. Boundary rules enforce the layering in docs/ARCHITECTURE.md.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

const noFeatures = { group: ["@smw/feature-*", "!@smw/feature-kit", "!@smw/feature-kit/*"], message: "Packages never import features." };
const noApps = { group: ["@smw/school*", "@smw/console*", "@smw/marketing*", "@smw/worker*", "**/apps/**"], message: "Features never import apps." };
const noFramework = { group: ["react", "react-dom", "next", "next/*", "@smw/ui/*", "@smw/runtime*"], message: "service.ts, schema.ts and inputs.ts stay framework-free (mobile API reuses them)." };

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/generated/**", "**/next-env.d.ts", "tickets/**", "**/migrations/**", "**/playwright-report/**", "**/test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      "@next/next/no-html-link-for-pages": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      // Server components legitimately read the clock; client components are reviewed by hand.
      "react-hooks/purity": "off",
    },
  },
  { files: ["packages/**/*.{ts,tsx}"], rules: { "no-restricted-imports": ["error", { patterns: [noFeatures] }] } },
  { files: ["features/**/*.{ts,tsx}"], rules: { "no-restricted-imports": ["error", { patterns: [noApps] }] } },
  { files: ["features/*/service.ts", "features/*/schema.ts", "features/*/inputs.ts", "features/*/*.service.ts"], rules: { "no-restricted-imports": ["error", { patterns: [noApps, noFramework] }] } },
);
