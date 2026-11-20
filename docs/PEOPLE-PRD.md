# PRD: People: student and staff profiles, self-service, bulk onboarding

Status: approved for build on 2026-11-20. It builds on docs/AUTH-PRD.md (logins, roles, family = student login).

## 1. Goal
Every person in the school has one complete profile.
- The office onboards a whole school from a spreadsheet in minutes.
- Students and teachers sign in, see their own profile, and keep their contact details current themselves.
- The office keeps control of the official fields.

## 2. What mature school software does (the bar)
Fedena, Entab CampusCare, Teachmint and MyClassboard all follow the same pattern:
- **Official fields are locked.** Name, DOB, admission number, class, employee ID and designation can only be changed by the office.
- **Contact fields are self-service.** Mobile, email, address and emergency contact can be changed by the person, and every change is logged.
- **Medical and emergency info** sits on the student profile and is visible to the class teacher.
- **Teachers see their own profile.** It shows the employee record, the classes and subjects they teach, the class they are class teacher of, and today's timetable.
- **Bulk onboarding takes a spreadsheet** (Excel or CSV) built from a downloadable template. Rows are checked first (a dry run) and then imported all at once.
- **Logins are created on import:**
  - Staff get an invite email if they have an email address, otherwise an access link.
  - Students get printable login slips.

## 3. Decisions
| # | Decision |
|---|---|
| P1 | **New student fields:** student mobile, alternate mobile, mother tongue, religion (optional), nationality, previous school, medical notes (allergies or conditions), emergency contact name and phone. **No Aadhaar:** it is sensitive under DPDP and APAAR already exists. |
| P2 | **New staff fields:** employment type (permanent, contract, part-time, visiting), years of experience, blood group, emergency contact name and phone. |
| P3 | **Self-edit, applied straight away and audit-logged:**<br>• Students: mobile, alternate mobile, address, emergency contact, medical notes, photo. Email goes through the existing email-change flow.<br>• Staff: mobile, address, emergency contact, qualification, photo.<br>Everything else shows "Ask the school office". |
| P4 | **One "My profile" page per person** (`/app/profile`):<br>• The account panel: details, password, devices.<br>• For students, the school record: class, admission number, guardians, contact, medical.<br>• For staff and teachers, the employee record. Teachers also see what they teach: class-teacher of, subjects by section, and a link to their timetable.<br>The route composes the panels from each feature, so no feature imports another. |
| P5 | **Spreadsheets:** upload `.xlsx` or `.csv`; the template downloads as CSV, which opens in Excel and in Google Sheets. One shared parser, `parseSheet()` in `@smw/integrations`, turns either into rows of strings. |
| P6 | **Student import:** keeps the current columns and adds the P1 fields plus guardian email, all optional. It stays all-or-nothing after a dry run. |
| P7 | **Staff import (new, `/app/staff/import`):**<br>• Columns: name, email, phone, role (Teacher, Accountant, Admin or a custom role name), employee_id (blank = auto), designation, department, qualification, joining_date, gender, dob, employment_type.<br>• Dry run, then commit in one transaction.<br>• On commit, staff with an email get an invite. For the rest, the page shows the access links with copy buttons and a "Download links (CSV)" button.<br>• Only an admin may import admins. |
| P8 | **Visibility:**<br>• A teacher sees medical notes and emergency contacts for students of their own sections only.<br>• Other students never see another student's record.<br>• Staff records (phone, address, emergency) are visible to admins and to people holding `staff:read`. |

## 4. Acceptance (each item has a test)
1. A student edits their mobile and emergency contact and sees the change. The change is in the audit log. Name, DOB and class cannot be edited by the student.
2. A teacher's My profile shows the employee record, their class-teacher class and their subjects by section. The teacher edits phone and qualification but not designation.
3. Importing an `.xlsx` and the same rows as `.csv` gives identical results. A bad row shows its line and column, and nothing is written.
4. A staff import of 3 rows (one with email, two without) creates 3 logins: 1 invite mail lands in Mailpit, and 2 access links are shown and work once. An unknown role name fails the dry run.
5. A teacher sees the medical notes of a student in their own section, and gets a 403 for a student in another section.
6. School isolation holds for every new query.
