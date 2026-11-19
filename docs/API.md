# Mobile REST API v1

One API per school, on the school's own host: `https://<school-host>/api/v1`. The host picks the school, so a token from school A never works on school B's host. The OpenAPI 3.1 description is at `/api/v1/openapi.json` (no token needed).

Money is in paise, dates are `YYYY-MM-DD`, timestamps are ISO 8601 (UTC).

## Sign in

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "identifier": "ADM-1042", "password": "..." }
```

`identifier` is the login ID (admission number for students), email or phone. Response:

```json
{ "token": "...", "expiresAt": "2026-12-18T10:00:00.000Z", "user": { "id": "...", "name": "Riya Sharma", "role": "student", "email": null, "avatarUrl": null } }
```

The token is the same session token the website uses. Store it in the device keychain or keystore. It lasts 30 days and slides forward on use (once a day). Send it on every call:

```http
Authorization: Bearer <token>
```

`POST /api/v1/auth/logout` ends the session. `GET /api/v1/me` tells you who the token belongs to, the school, which modules are on (`features`) and whether the school is read-only.

Login is limited to 10 tries per 15 minutes per account and per IP (`429 rate_limited`).

## Endpoints

| Method and path | Who | Returns |
|---|---|---|
| `POST /auth/login` | anyone | `{ token, expiresAt, user }` |
| `POST /auth/logout` | signed in | `{ ok: true }` |
| `GET /me` | signed in | user, school, features, readOnly, expiresAt |
| `GET /announcements?page&pageSize&q` | all roles | a page of announcements the role may see |
| `GET /timetable/today` | all roles | `{ day, rows[] }`: a teacher's periods, or the student's (children's) section |
| `GET /attendance/summary?from&to` | all roles | students and parents: per child counts, percent, recent absences (default last 30 days); staff: today's school summary |
| `GET /fees/dues` | all roles with fee access | students and parents: `{ dues[] }` per child; staff: the dues report, paged |
| `GET /results` | student, parent | `{ results[] }`: published results per child |
| `GET /assignments` | all roles | students and parents: `{ assignments[] }`, open work first; staff: a page |
| `GET /messages/threads` | all roles | `501 not_ready` until the messages module is wired |

Lists take `page` (from 1), `pageSize` (1 to 100, default 20) and `q`, and return `{ rows, total, page, pageSize, pageCount }`.

## Errors

Every failure has the same shape and an HTTP status:

```json
{ "error": { "code": "validation", "message": "Please fix the highlighted fields.", "fieldErrors": { "password": "Enter your password" } } }
```

| Status | `code` | Meaning |
|---|---|---|
| 401 | `unauthenticated` | No token, expired token, or token from another school. Sign in again. |
| 401 | `invalid_credentials` | Wrong login ID or password. |
| 403 | `forbidden`, `feature_off`, `account_disabled` | The role or the school plan does not allow this. |
| 404 | `not_found` | No such record, or the host is not a school. |
| 422 | `validation` | See `fieldErrors`. |
| 423 | `read_only` | The school is read-only (plan lapsed). Reads still work. |
| 429 | `rate_limited` | Too many login attempts. |
| 501 | `not_ready` | The endpoint exists but its module is not wired yet. |
| 500 | `internal` | Our fault. Quote the `x-request-id` response header to support. |

Every response carries `x-request-id`.

## For API developers

- Add a route as `apps/school/src/app/api/v1/<path>/route.ts`: `export const GET = apiHandler(async (req) => new SomeService(await bearerCtx(req)).method())` with `apiHandler`, `bearerCtx`, `readJson` from `@smw/runtime/bearer`. Services enforce permissions, so a route never checks roles itself unless the shape differs per role.
- Throw `AppError` subclasses; they become the error body above.
- Describe it in `_openapi.ts` (request bodies come from the same zod schema via `z.toJSONSchema`).
- Notifications are not exposed here yet; the bell and `/app/notifications` serve the panel.
