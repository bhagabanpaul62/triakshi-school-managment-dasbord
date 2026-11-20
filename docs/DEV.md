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

## Email

Mail goes out over SMTP, set only by env values. Locally it is Mailpit (`SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, no login); read it at http://localhost:8025. The demo server and early production use a free SMTP account:

| Provider | Settings | Free limit |
|---|---|---|
| Gmail | `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=<the Gmail address>`, `SMTP_PASS=<an app password>` | about 500 a day |
| Brevo | `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER=<SMTP login>`, `SMTP_PASS=<SMTP key>` | 300 a day |

- A Gmail app password needs 2-step verification on the account (Google account, Security, App passwords). Use the app password, not the real one.
- Set `MAIL_FROM` to the same address (Gmail) or to a sender you verified in Brevo, or the provider rewrites or rejects it.
- `SMTP_SECURE` is optional. Empty means implicit TLS on port 465 and STARTTLS on 587, which is right for both providers above.
- A failed send never fails the action. The person sees "We couldn't email it" and asks the school office for a link.
