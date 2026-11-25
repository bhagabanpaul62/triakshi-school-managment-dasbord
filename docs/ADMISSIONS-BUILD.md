# Admissions build contract

What to build: [ADMISSIONS-PRD](ADMISSIONS-PRD.md). House rules: "Rules" in [WEBSITE-ADMIN-BUILD](WEBSITE-ADMIN-BUILD.md) apply word for word, and "Screen rules" in [FINANCE-BUILD](FINANCE-BUILD.md).

## Wave 0: the core (branch `feat/admissions-core`)
Schema is done: `students.status` has `joining`; `joins_on`, `joins_year_id`, `joins_section_id`, `pen`, `left_reason`; `left_on` is the last day attended. Migration `0014_admissions_core.sql` is done. Nobody generates or edits migrations.

**Joining means**
- Read by: the student list (own filter), the record page, fees (bills, receipts, advances, refunds, desk search), the admission desk. By nothing else: no register, timetable, audience, message contact, library, transport, exam, home count or plan count.
- `section_id` is empty, `joins_section_id` is the plan; `class_id` is set. Login `users.status = 'disabled'`, switched to `active` on the day.
- Enrolment row is in `joins_year_id`, outcome studying.
- `students.join-due` (daily 00:10 IST): active, section, roll number, enrolment section, login on, audit. Waits with a reason when no section is planned or the plan is full, and tells admins once per reason.
- `joins_on` today or earlier at admission time is just an active admission, as today.

**Left means** `section_id` stays (their last section, for papers). So any read by section must ask for active. The enrolment of the year closes (`left` or `graduated`). Access: see below.

**Access after leaving, one place.** Both context builders (`packages/runtime/src/index.ts`, `bearer.ts`) pass the school's features through one function. For a left or alumni student the result is only fees, exams, home, notifications, settings. After 90 days from `left_on` the session ends and sign-in says "This login was closed because the student left the school. Ask the school office." No date = treated as closed.

**Duplicates.** Same name (case and spaces ignored) and birth date among joining, active or left students: refused with the student's name and admission number, unless `allowDuplicate` is ticked (audited). A left match offers "Open their record".

**Age.** Birth date is not in the future; age at joining is 2 to 25 for any class. Class age is a warning on the form, never a refusal: expected = grade + 5, two years either way.

**Guardians.** Two on the admission form. One phone for both is linked once.
