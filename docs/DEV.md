# Local development

Requires Node 26 (Argon2 comes from Node's own crypto), pnpm 12, Docker (Colima is fine).

```bash
cp .env.example .env.local     # once
pnpm install
pnpm db:up                     # Postgres :5433, RustFS (S3) :9000/:9001, Mailpit :8025
pnpm db:fresh                  # rebuild the local database and load demo data
pnpm dev                       # school :4100, marketing :4101, console :4102
```

| What | URL |
|---|---|
| Demo school 1 (active, Growth plan) | http://greenvalley.localhost:4100 |
| Demo school 2 (trial, Starter plan) | http://sunrise.localhost:4100 |
| Marketing site + signup | http://localhost:4101 |
| Platform console | http://localhost:4102 |
| Email inbox (Mailpit) | http://localhost:8025 |
| S3 browser (RustFS) | http://localhost:9001 |

## Demo logins (local seed only)

Every seeded account uses the password `demo12345`.

| School host | Login ID | Role |
|---|---|---|
| either school | `admin` | Administrator |
| either school | `accounts` | Accountant |
| either school | `teacher` | Teacher (more teachers come from the staff seed) |
| either school | admission number, e.g. `GR0001` (password: date of birth as DDMMYYYY) | Student (created by the students seed) |
| either school | parent's phone | Parent (password: last 6 digits of the phone) |

Console: `owner@triakshi.test` (TOTP secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`, add it to any authenticator app), `support@triakshi.test` (enrols 2FA on first login).

These values exist only in the local seed (`apps/school/scripts/seed.mts`). Production has no seed.

## Commands

| Command | Does |
|---|---|
| `pnpm gen` | Rebuild the feature registry after adding a feature |
| `pnpm check` | gen + lint + typecheck + all tests |
| `pnpm turbo run typecheck` | Typecheck every package with TypeScript 7 (`tsgo`, about 4x faster than `tsc`) |

TypeScript 7 (`tsgo`, from `@typescript/native-preview`) runs every `typecheck` script. `typescript@5.9` stays installed because Next.js builds, ESLint and editors still need the classic compiler API, which TypeScript 7 does not ship.
| `pnpm --filter @smw/feature-fees test` | One feature's tests (own database `smw_t_fees`) |
| `pnpm db:reset` | Drop and rebuild the local schema from the schema files |
| `pnpm --filter @smw/db generate` | Generate the SQL migration for production |
| `node scripts/new-feature.mjs <key> <requires>` | Scaffold a feature package |
