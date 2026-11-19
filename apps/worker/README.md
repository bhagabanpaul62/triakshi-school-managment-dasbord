# @smw/worker

Background jobs with pg-boss. Every job is idempotent and safe to retry.

- Connects with `DATABASE_URL_MIGRATE` because pg-boss creates its own `pgboss` schema on start (needs CREATE rights). Handlers use the normal console/school pools.
- Jobs come from `src/generated/jobs.ts` (each feature's `jobs.ts`) plus the platform job `email.send` (on demand) in `src/platform-jobs.ts`. `billing.lifecycle` comes from features/billing/jobs.ts and `domains.verify-pending` from features/domains/jobs.ts. A job name registered twice stops startup.
- Cron schedules in `src/registry.ts`: `billing.lifecycle` (01:30 IST), `notifications.email-digest` (08:00 IST), `modules.usage` (02:30 IST, no handler exists yet so it is not scheduled), `domains.verify-pending` (every 10 min). A schedule exists only when a handler with that name is registered.
- Logs are JSON (pino): job, id, ms, err. SIGTERM drains running jobs, then exits.

`pnpm --filter @smw/worker dev` / `start` / `test`.
