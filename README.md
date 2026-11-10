# SMW: school management platform

One codebase that many schools rent. Each school gets its own dashboard and public website, and you control every school from the platform console.

Design: [docs/superpowers/specs/2026-11-05-school-saas-platform-design.md](docs/superpowers/specs/2026-11-05-school-saas-platform-design.md)

## Structure

```
apps/              routes and wiring only
  marketing/       yourbrand.com: landing, pricing, signup and onboarding       :3001
  console/         console.yourbrand.com: you manage every school               :3002
  school/          <slug>.yourbrand.com: school website and /app dashboard     :3000
  worker/          background jobs
features/          one package per school feature, switched on per school
packages/
  db/              Drizzle client, platform tables, migrations, row-level security
  feature-kit/     feature declaration, registry, per-school on/off resolver
  auth/            sessions, password hashing, role checks
  themes/          theme tokens, presets, CSS variables
  onboarding/      signup and setup wizard
  site-templates/  school website templates and sections
  ui/              shared React components
  integrations/    email, payments, storage, DNS behind interfaces
  config/          TypeScript presets, ESLint, environment settings
infra/             Docker, Caddy, backups, deploy
tickets/           local ticket system
docs/              specs and decisions
```

Each folder has a README saying what goes there and when it is built.

## Commands

Run from the repository root. Requires Node 24 and pnpm.

| Command | What it does |
|---|---|
| `pnpm install` | Install everything |
| `pnpm dev` | Start every app |
| `pnpm --filter @smw/school dev` | Start one app |
| `pnpm build` | Build every app |
| `pnpm typecheck` | Type-check every app and package |
| `node tickets/tools/tickets.mjs next` | List tickets that are ready to start |
