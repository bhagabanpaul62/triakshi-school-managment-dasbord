# @smw/config

Shared configuration for the whole monorepo.

| What | Where | Status |
|---|---|---|
| TypeScript presets | `tsconfig/base.json` for plain packages, `tsconfig/nextjs.json` for Next.js apps | Ready |
| ESLint config | `eslint.config.mjs` | Ticket P0-05 |
| Environment settings, validated with zod at startup | `src/env.ts` | Ticket P0-07 |

Every other package reads environment variables only through this package. Secrets are never logged.
