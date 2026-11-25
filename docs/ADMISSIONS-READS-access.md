# Admissions: what a student login can reach after leaving

One rule, cut in one place. The session carries the student's phase (`SchoolAuth.validate` returns `phase`). `packages/runtime/src/phase.ts` turns it into the Ctx: for a left or alumni student `features` is the school's features limited to fees, exams, home, notifications, settings, and `leftUntil` is `students.access_until`. Both Ctx builders (`index.ts`, `bearer.ts`) use it, so support sessions get it too. The date is stored, inclusive, in IST: left or alumni are open until it, and with no date the login is closed (the session does not validate at all). Every reader goes through `accessOf` (sign-in, session, runtime `leftUntil`, notification writer and delivery, home). The 90 is `LEFT_ACCESS_DAYS` in `packages/auth/src/phase.ts`, used only by `accessUntilFor(lastDay)` = max(today, last day) + 90, which `features/students` calls to write the column. Migration 0014 gives students who had already left 90 days from the day it runs.

A right password on a closed or joining login resets the sign-in limiter before the refusal, so a family never reads "Too many attempts" for a correct password.

Anything that goes through `ctx.features` (every `SchoolService` call) is cut by that. This list is for what does not.

## Pages

| Path | How it is decided | Verdict |
|---|---|---|
| any `/app/...` page | `requireCtx` sends a left student to `/app/not-available` unless the path is home, fees, results, exams, notifications, profile | fixed, one place |
| `/app/not-available` | plain reason, until-date, way home | new |
| `/app` (home) | panel "left": what still works, until when, the office phone; no panel of a lost module | fixed |
| menu, mobile menu, bell, list of notifications | menu is built from `ctx.features`; the bell hides rows of lost modules | fixed (test in `apps/school/src/lib/menu.test.ts`) |

## Routes

| Route | Authorizes through | Verdict |
|---|---|---|
| `/api/files/[...key]` | `FilePolicy.canRead` by role: families get avatars and finance documents only | ok, those are what a left family still needs; closed sessions are signed out |
| `/api/calendar/[token].ics` (phone calendar link) | token only, then built with the school's whole feature set | **fixed**: stops for a left or alumni student, same 404 as a wrong link |
| `/api/calendar/public.ics` | no login, public items only | ok, not tied to a person |
| `/api/calendar/academic.pdf` | `actionCtx`, then year read by SQL | **fixed**: refused for a left student |
| `/api/calendar/events/[id]/*`, `files/[id]`, `slot/[id]` | `actionCtx` and `EventService` | ok, module off in the Ctx |
| `/api/messages/*`, `/api/notices/*`, `/api/meetings/*`, `/api/requests/*`, `/api/support/*` | `actionCtx` and the feature's service | ok, module off in the Ctx |
| `/api/exports/[id]`, `/api/privacy/*`, `/api/enquiries/*` | `actionCtx` and permission (settings, website) | ok, not for a student |
| `/api/pulse` | `actionCtx`; each count checks `ctx.features` | ok, counts of lost modules are 0 |
| `/api/push/key`, `/api/push/icon` | public, no personal data | ok |
| `/api/webhooks/mail`, `/api/internal/tls-allowed` | secret or internal | not reachable by a login |
| `/api/v1/auth/login` | `SchoolAuth.login` | fixed: the sentence for a closed login, the start date for a joining one, only after the right password |
| `/api/v1/me` | session | gives `features` (already cut) and `leftUntil` |
| every other `/api/v1/*` | `bearerCtx` and the feature's service | ok, module off in the Ctx |
| `/verify/[kind]/[token]` | token, no login, name partly hidden | ok, public by design |
| `/unsubscribe` | mail token | ok, only reduces mail |
| `/login`, `/forgot-password`, `/reset-password`, code sign-in | `SchoolAuth` | fixed: refused with the sentence only after the right password, code or link |
| `/support-login` | one-time token, then a normal session | ok, same cut as any session |

## Server actions
Every action goes through `serviceAction` or `actionCtx`, so the module is off in the Ctx. The few that use `getSession` directly (change password, profile, sign out) are for the person's own account and stay usable inside the 90 days.

## Messages sent to people
| Path | Verdict |
|---|---|
| `NotificationWriter.insert` | **fixed**: a left student gets rows only for fees, results and account security; closed gets none |
| queued push and email (`deliverDue`) | **fixed**: skipped with "The student has left the school." for any other topic |
| digest (`runDigest`) | **fixed**: same |
| mail sent straight to guardians by other jobs | not touched here; fee reminders to a left family are wanted |

## Left open on purpose
- Notification preferences still list every group. Nothing in it is a link.
- Fees and results pages must read a left student by login, not only active ones. That is in their own modules.
