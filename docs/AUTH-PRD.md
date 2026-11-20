# PRD: School sign-in, accounts and roles (RBAC)

Status: approved for build on 2026-11-19. Scope: the school app (`apps/school`) only. The console and the marketing signup stay as they are.

## 1. Problem

Today a school has five fixed roles: admin, accountant, teacher, student and parent. What each role can do is hard-coded in every `features/*/feature.ts`.

- An admin cannot make a "Librarian", "Transport in-charge" or "Front office" account. Each of those needs only the one or two modules that match the job.
- There is no "Forgot password" link. A user has to ask the office, and the office can only email a reset link.
- A student's first password is the date of birth (or the admission number), and nothing makes them change it.
- An admin cannot copy an access link to share on WhatsApp, or print login slips for a class.
- Parent logins are made from the guardian's phone number. The owner decided they are not needed. The student login is the family login.

## 2. What mature school software does (the bar)

Fedena, Teachmint, Entab CampusCare, MyClassboard and PowerSchool all share the same pattern:

1. **System roles plus custom roles.** Fixed roles (Principal or Admin, Teacher, Student) come built in. The admin also makes staff roles from a module-by-action matrix (for example "Fees: view, collect" or "Library: manage").
2. **Role templates.** Accountant, Librarian, Transport manager, Front office/Receptionist and Exam coordinator ship ready-made, and the admin can edit or copy them.
3. **Bulk credentials.** Student logins are made from admissions, credential slips can be printed per class, and the first sign-in forces a new password.
4. **Self-service recovery.** "Forgot password" by email. When there is no email, the office makes a reset link and shares it.
5. **Account controls.** Activate or deactivate, reset password, change role, see the last sign-in, and sign the user out everywhere. Every change is written to the audit log.
6. **Guard rails.** The last admin cannot be demoted or disabled. A role change ends that user's sessions. Limits on attempts slow down password guessing.

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **No parent logins.** Guardians stay as contact records on the student. The student account is what the family uses. Existing parent users are disabled by a migration. | Owner's call. One login per child is simpler for the office and for families. |
| D2 | **Base kinds: `admin`, `teacher`, `student`, `staff`**, plus the existing `accountant` kept as a system role. `users.role` stays the *base kind*, and it drives data scoping (a teacher sees their own classes, a student sees their own records). | Keeps the roughly 100 existing scoping checks working, with no rewrite. |
| D3 | **Custom roles = a `school_roles` row** (name, base kind, a set of `feature:permission` grants). A user may point at one with `users.role_id`. With no `role_id`, the user gets the defaults from `feature.ts`. | Smallest change that gives real RBAC, and existing users keep working unchanged. |
| D4 | **Ready-made templates** (seeded per school as editable custom roles): Accountant (fees + billing view), Librarian (library), Transport in-charge (transport), Front office (students read, enquiries, announcements), Exam coordinator (exams, results). | Admins start from a working role, not a blank matrix. |
| D5 | **Admin always has every grant.** An admin's grants cannot be edited. | The school can never lock itself out. |
| D6 | **Email = SMTP through nodemailer (already installed).** Locally that is Mailpit. On the demo and early production it is a free SMTP account: Gmail with an app password (about 500 mails a day) or Brevo's free plan (300 a day). This is set only by `SMTP_*` env values. We do not run our own mailbox. SES can come later as an env change. | Owner's call: free and no mail server to run. |
| D7 | **No public sign-up on a school site.** Accounts are made by the school. "Sign up" for a staff member or student means *activating* an account from an access link (setting a password). The school itself signs up on the marketing site, which already exists. | This is how every school product works. An open sign-up would let strangers into a school. |

## 4. Users and their flows

### 4.1 Sign in (`/login`)
- One page for everyone: "Email, phone or admission number" plus password. There are no role tabs, because the account knows its role.
- It shows a "Forgot password?" link and a "Show password" toggle.
- Errors stay as they are: a wrong login, a disabled account, or too many tries (10 per 15 minutes per IP and per account).
- After sign-in: if `must_change_password` is set, the user goes to `/app/change-password` and cannot open other pages until it is done. Otherwise they go to `?next` or `/app`.

### 4.2 Forgot password (`/forgot-password`)
- The user enters an email, phone or admission number. The page always gives the same answer: "If an account matches, we've emailed a reset link." This stops anyone using it to check whether an account exists.
- If the account has an email, a reset link is sent, valid for 60 minutes. Only the last 3 links work; older ones are cancelled.
- If the account has no email (most students), the answer adds: "No email on file? Ask your school office for a reset link."
- Limits: 5 requests per hour per IP, and 3 per hour per account.

### 4.3 Reset or activate (`/reset-password?token=`)
- This page already exists (`features/staff/ui/reset-password-page.tsx`). It now also handles **activation**: an invite token opens it with the title "Set up your account".
- Password rules: at least 8 characters, not the same as the login ID, date of birth or admission number, and not on a small common-password list.
- On success: all of the user's sessions end, `must_change_password` is cleared, the user is signed in, and they land on `/app`.
- Expired or already-used links show the right message and how to get a new one.

### 4.4 Forced change (`/app/change-password`)
- Shown when `must_change_password` is set. This is every student made with a default password, and every account an admin reset to a temporary password.
- It asks for the current password and the new one twice. The same rules as 4.3 apply.

### 4.5 My profile (`/app/profile`), all roles
- **Edit:** name, photo, email, phone. Students can edit only photo, email and phone; their name comes from the office.
- **Password:** change it here (current + new).
- **Sessions:** a list of devices (browser, IP, last seen) with "Sign out" per device and "Sign out everywhere else".
- **Info:** shows role, login ID and the last sign-in.

### 4.6 Admin: Users and roles (`/app/settings` → Users, Roles)
**Users tab**
- **Filters:** a list of every account, filtered by role, status (active, invited, disabled) and last sign-in, with search.
- **Row actions:** change role, disable or enable, reset password, copy access link, sign out everywhere.
  - **Reset password** has two options: email a link, or make a **temporary password** shown once. The temporary password sets `must_change_password`.
  - **Copy access link** makes a fresh activation or reset link (7 days) and copies it, so the office can paste it into WhatsApp.
- **Guard rails:** the last active admin cannot be demoted or disabled, and no one can disable their own account. A role change or disable ends that user's sessions. Every action writes to the audit log.

**Roles tab**
- **List:** system roles (Admin, Teacher, Student, Accountant), read-only with a "View access" link, and custom roles with their user counts.
- **New role or edit:** a name, a base kind (staff or teacher), and a **module × permission matrix** built from the school's enabled modules and each feature's permission keys. Each key gets a plain-language label such as "View", "Manage" or "Collect payments". The admin can also copy a role.
- **Delete:** only when no user has the role; otherwise the page asks to move those users first.

**Staff page (`/app/staff`)**
- "Add staff" picks a **role**, which can be a system role or a custom one.
- If the staff member has an email, an invite is sent, as today. If not, the page shows a copyable access link.

### 4.7 Student accounts
- Admitting a student makes the login, with the **admission number** as the login ID. The first password is the DOB as DDMMYYYY, or the admission number when there is no DOB. `must_change_password` is set to true.
- **Login slips** (`/app/students/credentials?classId=`): a printable page with one card per student showing the school, name, class, login ID, a first password or access link, and the school's address. It shows only students who have never signed in. It needs the `students:write` grant.
- On the student record, an admin can reset the password, copy an access link, or disable the login.

## 5. Permission model (technical)

- `Ctx` gains `grants?: ReadonlySet<string>`, with entries like `"fees:write"`.
- `requireCtx()` works out the grants for each request:
  - Admin: every grant.
  - A user with a `role_id`: that role's grants.
  - Otherwise: the defaults from `feature.ts` for the base role.
- `CrudService.can(p)` = the module is enabled **and** (`ctx.grants ? ctx.grants.has(key:p) : roles.includes(ctx.role)`). Bearer, system and test contexts stay grant-less and work as before.
- The menu (`buildMenu`) uses the same check.
- Data scoping keeps using `ctx.role` (the base kind). The `staff` base kind has no row scoping; it sees what its grants allow, like the accountant today.
- **Schema:**
  - `school_roles`: id, school_id, name, base, grants `text[]`, is_template, timestamps, with RLS.
  - `users.role_id` uuid null, referencing `school_roles`.
  - `users.must_change_password` bool, default false.
  - Add `"staff"` to `SCHOOL_ROLES`.
  - Add `"change_email"` to the token purposes (activation reuses `invite`).
- A migration disables the existing `parent` users.

## 6. Email

| Mail | Trigger |
|---|---|
| Staff invite or activation | Add staff, resend invite |
| Password reset link | Forgot password, admin "email a reset link" |
| Password changed notice | Any successful change or reset |
| Email change confirmation | Profile email changed (the link goes to the new address) |

- Every mail uses `emailHtml()` from `@smw/integrations`, in plain words, with the school's name in the subject.
- If sending fails, the action still succeeds and the user sees "We couldn't email it. Copy the link instead."
- `.env.example` documents the Gmail (`smtp.gmail.com:465`, app password) and Brevo (`smtp-relay.brevo.com:587`) settings.

### 6.1 Email OTP (one-time code)

A 6-digit code sent by email. It works with the links above, and every mail that has a link also carries the code. A code is easier on a phone, where the mail app and the browser are different apps.

| Use | Where | What the code does |
|---|---|---|
| Forgot password | `/forgot-password` → step 2 "Enter the code" | Code + new password resets it (same result as the link) |
| Sign in with a code | `/login` → "Email me a code instead" | Code signs in without a password. Only for active accounts that have an email |
| Confirm a new email | `/app/profile` → change email | Code typed on the profile confirms the new address |
| Verify my email | `/app/profile` → "Verify" next to an unverified email | Marks the email verified |

**Rules**
- **Format:** 6 digits, from `crypto.randomInt`, valid for 10 minutes.
- **Storage:** a `one_time_tokens` row with purpose `email_otp`. `meta` holds `{ use, codeHash, attempts }`, where `codeHash` = sha256 of userId:code with the school's id as salt. The plain code is never stored or logged.
- **Live codes:** only one per user per use. A new code cancels the old one.
- **Wrong tries:** after 5 wrong tries the code is dead. The message says "Too many wrong tries, send a new code".
- **Resend:** at most once every 60 seconds and 5 times an hour per account, plus the existing IP limits.
- **No leaks:** the same response whether or not the account exists ("If an account matches, we've emailed a code"). The code is compared with `timingSafeEqual`.
- **Subject:** "123456 is your <School> code". The body says what the code is for, when it expires, and "If this wasn't you, ignore this mail".
- **After use:** a used code ends the token. A reset by code ends all sessions and clears `must_change_password`, exactly like the link. Sign-in by code still respects `must_change_password` and disabled accounts.
- **Delivery:** the same SMTP sender as everything else, so it is free with Gmail or Brevo and needs no mailbox of our own. Locally the codes land in Mailpit (http://localhost:8025).
- **SMS or WhatsApp later:** the same table and rules with a different sender, once DLT is approved.

## 7. Out of scope (v1)
SMS or WhatsApp OTP (waits on DLT approval), two-factor for school admins, single sign-on with Google, parent logins, bulk import of staff.

## 8. Acceptance (each item has a test)
1. Admin makes a "Librarian" role with library access only. A user given that role sees only Library and Home in the menu, and gets 403 on `/app/fees`.
2. A teacher's access is unchanged (the existing e2e tests still pass).
3. A new student signs in with the admission number and DOB, is forced to change the password, and then lands on the student home.
4. Forgot password with an email: the mail arrives in Mailpit, the link works once, the second use shows "already used", and an expired link shows "expired".
5. Forgot password for an unknown login gives the same response as for a known one.
6. Admin copies an access link and opens it in a fresh browser: "Set up your account", set the password, signed in.
7. The last admin cannot be demoted or disabled, and an admin cannot disable their own account.
8. A role change ends the user's open sessions.
9. Disabled users cannot sign in, and their open sessions stop working.
10. Parent logins no longer exist. Guardians still show on the student record, and no page offers a "parent" role.
11. Login slips print one card per never-signed-in student of the class.
12. School A's roles and users are never visible to school B (isolation test).
13. 11 failed sign-ins in a row are rate-limited, and forgot-password is rate-limited too.

## 9. Build plan
1. Foundation (done by the lead first): the schema, `Ctx.grants`, and `can()`.
2. In parallel, Sonnet agents with file ownership:
   - A: roles service and the Users and Roles UI (`features/settings`, plus the role picker in `features/staff`).
   - B: auth flows (`apps/school/src/app/{login,forgot-password,reset-password}`, `packages/auth`, the profile page, change-password, emails).
   - C: parent retirement plus student credentials (`features/*/feature.ts` parent grants, `features/students`, `features/home` parent view).
3. Then: typecheck, unit tests, an e2e spec `tests/e2e/auth-rbac.spec.ts` covering section 8, and a separate review.
