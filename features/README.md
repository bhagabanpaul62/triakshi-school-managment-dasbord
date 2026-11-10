# Features

One package per school feature, such as students, attendance or fees. A feature is built once and switched on per school from the console.

## Layout of a feature package

```
features/<name>/
├─ package.json       name "@smw/feature-<name>"
├─ feature.ts         key, name, stage, required features, menu items, permissions, settings schema
├─ schema.ts          Drizzle tables. Every table has school_id and row-level security
├─ service.ts         business logic. No React and no Next.js, so a mobile API can reuse it
├─ inputs.ts          zod schemas for every input
├─ ui/                pages and components for the school app
└─ service.test.ts    tests, including the school A versus school B isolation test
```

## Rules

- Route files in `apps/school` are one-line re-exports of pages from `ui/`.
- `service.ts` and `schema.ts` never import React or Next.js.
- Features may import packages. Packages never import features.
- A feature may use another feature only if it lists it in `requires`.
- Tables are declared here, but migrations are generated in `packages/db`, in one ordered history.

## Giving a feature to some schools only

1. Build it here with stage `alpha`.
2. In the console, switch it on for School A. Only School A sees the menu item and pages, and services refuse other schools.
3. Later, switch it on for School B and School C. No deploy is needed.
4. When it is ready for everyone, mark it `ga` and add it to plans.

Each school can also keep its own settings for a feature, checked against the feature's settings schema.
