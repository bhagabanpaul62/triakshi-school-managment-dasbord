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
| `GET /announcements?page&pageSize&q` | all roles | a page of sent notices the role may see: `{ id, type, number, title, body, excerpt, pinned, categoryName, publishedAt }` (the old `audience` field is gone; use `/notices` for the family's own feed) |
| `GET /timetable/today` | all roles | `{ day, rows[] }`: a teacher's periods, or the student's (children's) section |
| `GET /attendance/summary?from&to` | all roles | students and parents: per child counts, percent, recent absences (default last 30 days); staff: today's school summary |
| `GET /fees/dues` | all roles with fee access | students and parents: `{ dues[] }` per child; staff: the dues report, paged |
| `GET /results` | student, parent | `{ results[] }`: published results per child |
| `GET /assignments` | all roles | students and parents: `{ assignments[] }`, open work first; staff: a page |
| `GET /messages/threads` | all roles | same as `GET /conversations` (kept for old clients) |

### Notices (module `announcements`)

| Method and path | Returns |
|---|---|
| `GET /notices?tab=inbox\|archive&page&pageSize&q&category` | `{ rows, total, page, pageSize, pageCount, unread }`: notices sent to me, those needing an answer first. A row has `noticeId`, `recipientId`, `title`, `excerpt`, `urgent`, `pinned`, `seen`, `needsAnswer`, `answered`, `dueAt`, `responseKind`, `withdrawn`, `childName` |
| `GET /notices/{id}?lang` | one notice with `content`, `other` (second language), `files`, `answering` (`open`, `locked`, `closed`, `none`) and `recipients` (one per child, with the answer so far). Opening it marks it seen |
| `POST /notices/{id}/respond` `{ answer, byName, byRelation, recipientId? }` | `{ recipientId, changed }`. `recipientId` is needed only with two or more children. Answers can change until the last date (`409` after). A question that asks for a file takes it as multipart (see "Files") |

### Conversations (module `messages`)

| Method and path | Returns |
|---|---|
| `GET /conversations?view=all\|unread\|archived&studentId&q&cursor` | `{ rows, next, unread }`. This is cursor paging, not `page`: send `next` back as `cursor`; `next` is `null` on the last page. `unread` counts across all conversations. A row has `id`, `subject`, `kind`, `state`, `studentName`, `lastMessageAt`, `people`, `unread`, `preview`, `pinned`, `muted`, `archived` |
| `GET /conversations/{id}?before` | the conversation, newest message last, with `block` (why the box is closed) and `notice`. Opening it marks it read. `before` = `oldestAt` of the oldest message you hold |
| `POST /conversations` `{ studentId?, recipientIds[], subject, body, clientId? }` | `{ id }`. Families write to a teacher or the office about their own child; staff start from a student |
| `POST /conversations/{id}/messages` `{ body, clientId? }` | the new message. Send the same `clientId` on a retry and you get the first message back, never a second |
| `POST /conversations/{id}/read` | `{ ok: true }` |

Files: send multipart (see "Files"). `GET /files/messages/{id}` gives a link to a file in a conversation I am in.

### Requests (module `requests`, Growth plan and up)

| Method and path | Returns |
|---|---|
| `GET /requests?page&pageSize&q&state&category&view` | a page of `{ id, number, subject, state, categoryName, studentName, dueAt, overdue, createdAt, ... }`. `view` (`mine`, `unassigned`, `team`, `overdue`, `all`) is for staff |
| `GET /requests/categories` | `{ rows: [{ id, name, nature, fields }] }`: what a request may be about, and the extra `fields` each one asks for |
| `POST /requests` `{ categoryId, subject, details, studentId?, values?, aboutUserIds? }` | `{ id, number }`. A family asks about its own child; the office writes one down and must give `studentId` |
| `GET /requests/{id}` | the request with `timeline`, its `thread` and `can` (what this person may do next) |
| `POST /requests/{id}/answer` `{ body }` | `{ ok: true }`. Staff answer the family; a family login writes back to the school |
| `GET /requests/{id}/files/{fileId}` | `{ url, expiresIn }` for a file in a request I may see. Office notes are never shown to a family |

### Calendar (module `events`)

| Method and path | Returns |
|---|---|
| `GET /calendar?from&to&layers` | `{ from, to, items[] }`. Dates are India dates (`YYYY-MM-DD`, `to` is the last day shown; default today to +30 days; at most 93 days, else `422`). `layers` is a comma list of `events,holidays,exams,homework,timetable,meetings,fees`; layers you may not see are left out. An item has `id`, `layer`, `title`, `startsAt`, `endsAt`, `allDay`, `href`, `cancelled`, `meta`. Drafts are never shown |
| `GET /calendar/events/{id}` | one event: place, `bring`, `rsvp` rules, `files`, my answer in `me`. `counts` only for the person who runs it |
| `POST /calendar/events/{id}/rsvp` `{ answer: "yes"\|"maybe"\|"no", guests? }` | `{ status: "going"\|"waiting"\|"maybe"\|"not_going" }`. `409` when the event is over, cancelled or closed for answers |

### Meetings (module `meetings`, Growth plan and up)

| Method and path | Returns |
|---|---|
| `GET /meetings?page&pageSize&q&state` | a page of meetings I may see; `mine` is a family's booked count |
| `GET /meetings/{id}` | a family gets its booking page (`kids[].teachers[].slots`, `booked`, and `can` with `why`); a teacher or the office gets windows and slots |
| `POST /meetings/{id}/book` `{ slotId, studentId? }` | the booked time. `409` when someone just took it |
| `POST /meetings/{id}/change` `{ fromSlotId, toSlotId, studentId? }` | the new time; if it is gone the old one stays |
| `POST /meetings/{id}/cancel` `{ slotId, studentId? }` | gives back one booked time. It does not cancel the meeting |

### Notifications and push

| Method and path | Returns |
|---|---|
| `GET /notifications?page&pageSize&tab=action\|all&unread=1&group` | a page plus `unread` (the bell) and `needsAction` |
| `POST /notifications/read` `{ id }` or `{ all: true }` | `{ updated }`. Someone else's id changes nothing |
| `GET /notifications/preferences` | per group `{ push, email, locked, own }`, `digestHour`, `quietFrom`, `quietTo`, `awayUntil`, `awayText`, `language` |
| `PUT /notifications/preferences` `{ groups?, quiet?, digestHour?, language?, away? }` | the new settings. Only what you send changes. `quiet: null` clears quiet hours; `away: { until: null }` ends being away. A group that is always sent answers `422` |
| `GET /push/devices` | `{ rows: [{ id, device, createdAt, lastOkAt }] }` |
| `POST /push/devices` `{ endpoint, p256dh, auth, device? }` | `{ ok: true }`. This registers a Web Push subscription (https only). Repeating it is safe. Native APNs and FCM tokens are not supported yet |
| `DELETE /push/devices/{id}` | `{ ok: true }`; `404` for a device that is not yours |

The public half of the push key is at `GET /api/push/key` (no token); it answers `404` when the school has push switched off.

### Files

Five writes take files: `POST /conversations`, `POST /conversations/{id}/messages`, `POST /requests`, `POST /requests/{id}/answer`, and `POST /notices/{id}/respond`. JSON works as before. To send files, use `multipart/form-data` with the same JSON in a text part named `json`, and the files as parts named `files` (repeat it). For a notice answer, name each file part `file:<questionId>` for the question that asks for it. The limits are the website's: at most 5 pictures or PDFs per message, checked by content. A notice answer takes pictures and PDFs. A bad file is `422` with `fieldErrors.files`, and nothing is stored.

```http
POST /api/v1/conversations/{id}/messages
Content-Type: multipart/form-data; boundary=...

--...  name="json"          {"body":"Done, here is the page."}
--...  name="files"; filename="page.pdf"
```

Downloads answer JSON, never a redirect: `{ url, name?, expiresIn: 60 }`. Open `url` at once; it stops working after a minute and must not be stored. Ask again for a new one.

| Method and path | For |
|---|---|
| `GET /files/messages/{id}` | a file in a conversation I am in |
| `GET /files/notices/{id}` | a file on a notice sent to me (the `files` of `GET /notices/{id}`) |
| `GET /requests/{id}/files/{fileId}` | a file in a request I may see |

Someone else's file, and one that does not exist, are both `404`.

### Rules for all of these

- A thing that is not yours is `404 not_found`, never `403`: the API does not say whether it exists. So is an `{id}` that is not a UUID.
- A support session (school staff acting for Triakshi support) is refused private talk, answers and requests.
- In a read-only school, reading and read marks work; sending, booking and answering give `423 read_only`.
- A module the school's plan does not include gives `403 feature_off`.

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
| 403 | `forbidden`, `feature_off`, `account_disabled`, `password_change_required` | The role or the school plan does not allow this. |
| 404 | `not_found` | No such record, a record that is not yours, or the host is not a school. |
| 409 | `conflict` | The state changed: a meeting time was just taken, the notice is closed, the last date passed. The message says what to do. |
| 422 | `validation` | See `fieldErrors`. |
| 423 | `read_only` | The school is read-only (plan lapsed). Reads still work. |
| 429 | `rate_limited` | Too many login attempts. |
| 500 | `internal` | Our fault. Quote the `x-request-id` response header to support. |

Every response carries `x-request-id`.

## For API developers

- Add a route as `apps/school/src/app/api/v1/<path>/route.ts`: `export const GET = apiHandler(async (req) => new SomeService(await bearerCtx(req)).method())` with `apiHandler`, `bearerCtx`, `readJson` from `@smw/runtime/bearer`. Services enforce permissions, so a route never checks roles itself unless the shape differs per role.
- Throw `AppError` subclasses; they become the error body above.
- Describe it in `_openapi.ts` (request bodies come from the same zod schema via `z.toJSONSchema`).
- Bodies reuse the feature's own zod input where it has one (`respondInput`, `startInput`, `raiseInput`, `bookInput`, `answerInput`), so the panel and the API validate the same way. Route files export only handlers; shared schemas live in `_schemas.ts`.
- Files: read the body with `readBody` from `_lib.ts` (JSON or multipart) and pass `files` to the same service method the panel uses.
- Tests, from `apps/school`: `pnpm test`. `api.test.ts` covers two schools, auth, 404s, validation, and that every route is in OpenAPI. `communication.test.ts` runs real rows with a teacher, two families and a support session: conversations and files, requests, notices with a file answer, RSVP, meeting booking.
