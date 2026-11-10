# @smw/db

Database access: the Drizzle client, platform tables, the one ordered migration history, row-level security helpers, and `withSchool()`, the client scoped to one school.

## What goes here

- Drizzle client built on the `postgres` driver
- Platform tables: schools, school_domains, users, plans and the rest of spec §8
- All migrations, in one append-only folder. Feature packages declare their own tables, but migrations are generated here
- Row-level security policies and `resolve_school_by_host()`
- `withSchool(ctx, fn)`: opens a transaction and sets `app.school_id` before any query

## When

Phase 0, tickets P0-10 to P0-12.
