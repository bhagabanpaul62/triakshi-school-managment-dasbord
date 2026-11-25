# PRD: Website and admin (website, domains, settings, setup, support, home)

Status: **built** 2026-11-25 on branch `feat/website-admin`. How it works now: [WEBSITE-ADMIN](WEBSITE-ADMIN.md). Build contract: [WEBSITE-ADMIN-BUILD](WEBSITE-ADMIN-BUILD.md).
Builds on [PRD](PRD.md), [AUTH-PRD](AUTH-PRD.md) (roles; the student login is the family login), [PEOPLE-PRD](PEOPLE-PRD.md), [FINANCE-PRD](FINANCE-PRD.md) and [COMMUNICATION-PRD](COMMUNICATION-PRD.md). Screen rules and "No dead ends" in [FINANCE-BUILD](FINANCE-BUILD.md) apply word for word.

## 1. Goal
The school's front door and its control room. A stranger finds the school, trusts it and asks for a seat; the office turns that into an admission without a notebook; the admin runs the school's account alone; and everybody who signs in sees first what is theirs to do today.

**The problem.** All six areas exist, but as first versions. The website cannot be rolled back, reordered or scheduled. An enquiry is one row with five states and a notes box. "Main domain" does nothing. Settings is four tabs. The setup wizard ends at the website and forgets the other 20 modules. A support ticket reaches the school only if somebody happens to look. A librarian's home is a list of links.

### Eight rules everything follows
1. **Live is a frozen copy.** What visitors see changes only by Publish, and every published copy can be brought back.
2. **An address never just stops.** A renamed page or a new main domain leaves a permanent redirect.
3. **Every enquiry has a next step, an owner and a date**, or it is closed with a reason.
4. **A name on a public page is there on purpose.** No child, teacher or phone number is shown by default rule alone; the school can always hide it.
5. **Who did what is always answerable**: who, when, from where, what it was before. Nobody can edit or delete the answer.
6. **The school owns its data**: it can take all of it, see who outside looked, and close the account, also when read-only.
7. **Setup is never "finished" by a button.** Progress is read from the data, for every module, and can be handed to a colleague.
8. **Home shows work, not decoration.** Each panel answers one question, leads somewhere, and fails alone.

### 1.1 Success measures (hypotheses; there is no baseline)
| Measure | How measured | Target (first term) |
|---|---|---|
| Schools with a published website in 7 days | `school_sites.published_at` | 80% |
| Website enquiries answered within one working day | first non-new stage event | 85% |
| Open enquiries with a future next step | tasks | 95% |
| Enquiry to admission, known by source | reports | 100% of enquiries have a source |
| Custom domains that work 30 days after adding | health | 95% |
| DNS breakage told to the school | domain events | under 24 h |
| Time from approval to first attendance marked | setup status | under 2 days |
| Support first reply inside target | ticket clock | 90% |
| Tickets where the school was told of the reply | notification rows | 100% |
| Home page, server time, 3,000 students | measured | under 600 ms |

### 1.2 Who it is for
| Person | Main need |
|---|---|
| Visitor (parent looking for a school) | find fees, classes, distance, contact; ask for a seat in a minute on a phone |
| Principal / admin | a site that looks right, admissions under control, who has access, proof of what happened |
| Front office | today's calls and visits, one screen per family, no retyping at admission |
| Website editor (custom role) | change words and photos; publishing may need an approver |
| Accountant, cashier, bursar, auditor | money first on home |
| Teacher | periods, registers, grading, messages |
| Librarian, transport in-charge, other custom roles | a home made of the modules they hold |
| Family (student login) | what needs an answer, today's classes, homework, dues |
| New school's admin | go from approved to running without help |
| Triakshi support, sales, owner | see who is stuck, answer in time, look inside only with the school's knowledge |

## 2. What exists today (code read 2026-11-25)

### 2.1 Size
| Area | Lines (with tests) | Our estimate of a mature area |
|---|---|---|
| website (site, theme, enquiries) + site-templates | 2,050 + 1,740 | 45% |
| domains | 760 | 50% |
| settings (profile, users, roles, audit, export) | 2,900 | 60% |
| setup | 1,760 | 55% |
| support (school) + desk (console) | 430 + 230 | 25% |
| home | 1,655 | 55% |

### 2.2 What works and stays
School isolation (RLS); structured sections with live preview and five designs (owner's decision: **no raw HTML**); contrast check on themes; honeypot and rate limits on the public form; the wizard saving through each module's own service; approval before entry; append-only audit; export that works when read-only and leaves private talk out; support sessions that are logged and cannot read private things; home slots that fail alone.

### 2.3 Defects
Proof: R = read in code. Each gets a test that fails before the fix.

| # | Area | Defect | Proof |
|---|---|---|---|
| W1 | Website | Two admins editing at once: the draft is read without a lock and written whole, so the second save silently drops the first. | R |
| W2 | Website | Page order, menu, page address and footer links cannot be changed at all (only title; footer text). | R |
| W3 | Website | Publish overwrites the only copy. There is no way back. | R |
| W4 | Website | Preview works only for the built-in admin role; a custom role with `website:manage` sees the live site instead of its draft. | R |
| W5 | Website | No canonical address: the free address and the own domain both serve the same pages to search engines. | R |
| W6 | Website | Every active teacher's name is public with no way to hide one. | R |
| W7 | Website | News and events cannot be opened; the text is cut and leads nowhere. | R |
| W8 | Website | A removed photo leaves an empty space on the live site; nothing says where it is used. Photos have no alt text. | R |
| W9 | Enquiries | "Convert to student" never records the link (`converted_student_id` is never written); the enquiry stays open after admission. | R |
| W10 | Enquiries | Nobody is told about a new enquiry; the family gets no confirmation. | R |
| W11 | Enquiries | The same family can be entered any number of times with no hint. | R |
| W12 | Enquiries | The public form takes no consent and personal data is kept for ever. | R |
| D1 | Domains | "Main domain" changes a flag nothing reads: no redirect, no canonical, links in mail still use the free address. | R |
| D2 | Domains | The page promises that the bare domain "is sent on to www". Nothing does that. | R |
| D3 | Domains | Anyone can add a domain they do not own and block the owner for ever (unique on every row, verified or not). | R |
| D4 | Domains | A verified domain is never checked again: broken DNS or a lapsed domain bought by someone else goes unseen. | R |
| D5 | Domains | A bare domain is "verified" by TXT alone, so it can be Live while pointing somewhere else. | R |
| S1 | Settings | Audit rows say "Updated student X" but not what changed, and cannot be exported or opened. | R |
| S2 | Settings | A school export builds one JSON file in memory inside the request; a big school will time out. Files are kept for ever. | R |
| S3 | Settings | An admin cannot add another admin or office login from Settings; "add a second admin" is advice with no button. | R |
| S4 | Settings | Failed sign-ins are nowhere to be seen. | R |
| S5 | Settings | The one-student export lists at most 1,000 students in a dropdown. | R |
| U1 | Setup | Progress ends at 7 steps; fees, timetable, class teachers, login slips and 15 other modules are never mentioned. | R |
| U2 | Setup | Dismissing the first-day card is kept in one browser only. | R |
| P1 | Support | A reply from the team reaches nobody: no notification, no mail. New tickets reach no one at Triakshi either. | R |
| P2 | Support | The console ticket search box does nothing (`q` is ignored). | R |
| P3 | Support | No attachments, no ticket number, no category; "Resolved" never closes; closing is final for the school. | R |
| P4 | Support | Staff can enter a school without the school knowing; the school has no list of those visits. | R |
| P5 | Support | A signed-in admin of another role (accountant, office) cannot ask for help at all. | R |
| H1 | Home | The whole page waits for its slowest panel. | R |
| H2 | Home | A custom role gets links only, whatever modules it holds; a cashier or librarian has no work on home. | R |
| H3 | Home | Teacher marks panel loads every open exam one by one; accountant panel runs the full dues report once per class. | R |
| H4 | Home | Numbers have no comparison; nothing says if 91% present is good. | R |

## 3. References: what we take and skip
| Question | Reference | Take | Skip, why |
|---|---|---|---|
| Undo a publish | [Webflow backups](https://help.webflow.com/hc/en-us/articles/33961244069395), [Wix site history](https://support.wix.com/en/article/viewing-and-managing-your-site-history) | every publish is a version; restoring first saves the current one; restoring does not touch data-fed content (news, events) | autosave points every N edits: our edits are per section and have their own undo |
| What a CBSE school must publish | [Mandatory public disclosure, SARAS circular](https://saras.cbse.gov.in/saras/Circulars/Circular3.pdf), [2026 reminder](https://www.careerindia.com/news/cbse-mandatory-public-disclosure-norms-2026-what-schools-must-upload-055688.html), [compliance gap](https://news.careers360.com/how-many-schools-violate-cbse-regulations-on-mandatory-disclosures) | a ready disclosure page in five parts with documents, linked from the home page, and a "what is missing" count | we do not claim it makes a school compliant: the board changes the format, the school checks the current circular |
| Enquiry handling | [LeadSquared admissions](https://www.leadsquared.com/education/student-enrollment-management-system/), [SchoolAdmin / Finalsite inquiry](https://schooladmin.zendesk.com/hc/en-us/articles/6219398296461) | one list for every source, stages with an owner, confirmation to the family, follow-ups that cannot slip, source report | lead scoring and auto-calling: a school has 5 enquiries a day, not 5,000 |
| Own domain | [Vercel troubleshooting](https://vercel.com/docs/domains/troubleshooting) | check each record on its own and say which one is wrong, apex by A record, warn about a proxied record | buying domains inside the product |
| Audit log | [WorkOS audit logs](https://workos.com/docs/audit-logs) | same shape for every entry, filters by actor/action/target/date, CSV export | streaming to a SIEM |
| Ticket life | [Zendesk lifecycle](https://support.zendesk.com/hc/en-us/articles/8263915942938-About-the-ticket-lifecycle-and-ticket-statuses) | pending comes back to open on reply; resolved reopens by reply; closed by the clock, then a follow-up ticket | custom statuses |
| Setup guide | [Shopify setup guide pattern](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/setup-guide), [WooCommerce: dismissed list can be restored](https://woocommerce.com/document/woocommerce-onboarding-wizard/) | one list with real progress, can be hidden and brought back | permanent dismiss |
| Data requests | [DPDP Rules 2025](https://www.mondaq.com/from-draft-to-reality-key-changes-in-indias-dpdp-rules-2025/1775140), [schools and children's data](https://ssrana.in/articles/schools-coaching-centres-platforms-processing-childrens-data-are-you-compliant/) | a register with a due date, consent on the public form, limited keeping time | legal advice. The 90-day limit comes from secondary sources: it is a setting, and a lawyer must confirm it |

---

## 4. Website (16a): the public site

### 4.1 Content model
Page: `slug, title, intro, seo {title, description, imageUrl}, sections[], hidden, noindex`. Section: existing 17 types plus **video** (YouTube or Vimeo link, privacy-friendly player, loads on click), **documents** (uploaded PDFs with name, kind, date, size, grouped), **people** (named people with photo, role, line: management, committee), **achievers** (toppers and winners: name, photo, result, year), **contact_form** (a general question, lands in Enquiries as kind *question*), **disclosure** (section 4.3). Every section has `hidden`. Menu: ordered items, page or link, one level of children, at most 8 top items. Footer: text, columns of links, social links.

Site settings (not versioned with pages): notice bar (text, link, tone, from, until), social links, call / WhatsApp / directions buttons on phones, search engines on or off, teachers not to show, offline message.

### 4.2 What a visitor gets
- Pages, plus `/news`, `/news/<id>`, `/events`, `/events/<id>` for public notices and events (real pages with their own share image; a withdrawn notice shows "This notice was withdrawn").
- A school-styled 404 with the menu and the enquiry button; a styled "website is being updated" page when offline; redirects for old addresses.
- Title, description, canonical on the main domain, Open Graph and Twitter image, `School` structured data (name, address, phone, logo, social links), breadcrumb data, sitemap with last-changed dates on the main host only, robots that refuse indexing on secondary hosts, when off, and on hidden pages.
- WCAG AA: skip link, one h1, landmarks, alt text, focus, reduced motion, 44 px targets, no sideways scroll at 320 px, no content that needs JavaScript to be read. No cookies, no third-party scripts; maps and video load only on a click.
- Staff list shows only teachers the school has not hidden; names are shown as the school wrote them.

### 4.3 Mandatory disclosure
`/app/website/disclosure`: five parts: A general information (prefilled from Settings), B documents, C results and academics, D staff, E infrastructure. Each row: filled / missing / not applicable. Documents upload here as public PDFs with an expiry date where one applies (fire, building safety): a warning 30 days before and when it has passed. One button puts the page on the site and a link in the footer. Shown to every school; for a non-CBSE board it is called "School information".

### 4.4 Insights
Daily counts per page with no cookies and no personal data: views, where from (search, social, another site, direct), enquiries. Bots and signed-in staff are not counted. 30 or 90 days: trend, top pages, sources, and the share of visits that became an enquiry.

## 5. Website (16b): the editor and its rooms

Menu: **Website** (overview), **Enquiries**, **Domain**, **Theme**. Inside Website a tab bar: Overview, Edit, Pages and menu, Media, Disclosure, Versions, Insights, Settings.

| Page | Purpose and content | States |
|---|---|---|
| `/app/website` Overview | Live address with copy and QR; state (not published, live, live with changes waiting, scheduled, offline); what will change on publish; publish / schedule / preview link; checklist (logo, home headline, 3 own photos, contact, admission form, teachers checked, search description, disclosure, domain); 30-day views and new enquiries; last publish by whom | never published: one big "Pick a look" to Edit |
| `/app/website/edit` | Section editor with live preview (exists) plus: drag and arrow reorder, duplicate, hide, copy to another page, undo toast after remove, add-section picker with previews and search, device widths, unsaved-changes guard, "Asha is editing this" hint, template picker | another person changed this section: shows both, keep mine / take theirs |
| `/app/website/pages` | Pages: title, address, state (live, changed, draft only, hidden), sections, search-result preview, last change. Add from template, duplicate, rename address (makes a redirect), hide, delete (30 s undo). Menu builder beside it: reorder, nest one level, external link, rename | plan limit: says the limit and links to Billing |
| `/app/website/media` | Photos and documents: grid/list, search, alt text, where used, size, replace (same address everywhere), delete blocked while used by the live site (shows where) | empty: upload |
| `/app/website/disclosure` | 4.3 | |
| `/app/website/versions` | Every publish: number, when, who, note, what changed; preview any; restore to draft (current draft saved first); name a version; compare two as a list of changes | first publish: explains |
| `/app/website/insights` | 4.4 | no visits yet: share address + QR poster (PDF) |
| `/app/website/settings` | Notice bar, buttons, social, search engines, teachers shown, redirects (list, add, remove), take offline / bring back (typed confirm), who may publish | |
| `/app/theme` | exists; add: draft-safe (theme saves apply at once, says so), reset, upload logo and favicon here, sample of panel and site side by side | limited plan: what is open and what is not |

**Publishing.** `website:manage` edits, `website:publish` publishes (admin by default). Someone without it presses *Ask to publish* with a note: publishers get a `work.approval` notification; publish or send back with a reason. Schedule: freezes the draft as it is now, publishes at the chosen time; edits made later wait for the next publish; cancel any time. Publish checks: broken internal links, empty required fields, photos that no longer exist, missing home headline: blockers stop, warnings can be accepted.

**Concurrency.** Every draft write locks the row. A section save carries the hash of the section as it was opened; if it changed since, the save is refused with the other person's name and time.

## 6. Website (16c): admission enquiries

### 6.1 Stages
`new → contacted → visit → visited → applied → offered → admitted` and `closed` (with a reason) or `waitlist` from any open stage. Moving back is allowed and logged. `admitted` is set only by admitting the child (or by linking an existing student). An old `closed` row keeps its place with reason "Not recorded".

Kinds: *admission* and *question* (general contact form; only new → contacted → closed).

### 6.2 One enquiry
Reference (`E-2026-0042`, gap-free per year), child (name, birth date, gender, class applied, session, previous school), family (parent, relation, phone, second phone, email, address), source (website, phone, walk-in, referral, fair, social, newspaper, other: school can add), campaign (from `?utm_source`, `?utm_campaign`), message, consent (text version, time), owner, next step, priority, tags.

`/app/enquiries/[id]`: header with stage track and one primary action for the stage (Call now, Book visit, Record visit, Mark applied, Make offer, Admit); left: timeline (created, calls with outcome, notes, mails and WhatsApp opened, visits, stage moves, owner changes, merge, admission); right: next steps, child, family, source, duplicates ("2 other enquiries from this phone"), sibling ("This phone belongs to the family of Riya, 4-A"), seats left in the class.

- **Log a call**: outcome (talked, no answer, call later, wrong number, not interested) sets the natural next step.
- **Follow-ups**: kind (call, visit, test, document, other), due time, owner, done with outcome. An open enquiry with none shows "No next step" in warning.
- **Visits**: a slot with date and time; the family gets a mail with an .ics when there is an email; a reminder to the owner on the day.
- **WhatsApp and email** from templates with `{child} {parent} {class} {school} {reference} {visit}`: WhatsApp opens the app with the text ready (no sending by us until DLT/API is there) and the timeline records "opened"; email goes through the mail budget.
- **Merge** duplicates: keeps the older reference, moves the timeline, logged, cannot be undone (says so).
- **Admit**: `/app/enquiries/[id]/admit` opens the admission form prefilled, with the cap and seats shown; on success the student is linked, the enquiry is admitted, the timeline has the student's link, and the student record shows "Came from enquiry E-…". Also "Link to an existing student".

### 6.3 Lists
`/app/enquiries` with views: **Today** (follow-ups due and overdue, visits today, new without a call: each with its action), **List** (filters: stage, class, session, source, owner, kind, overdue, no next step, date; saved views; bulk assign, stage, close; CSV), **Board** (stages as columns, drag with undo, counts; on phones a stage picker).
`/app/enquiries/reports`: funnel by stage reached, by class against seats, by source and campaign, response time, lost reasons, owner load; period and session filters; CSV. Every number opens its list.
`/app/enquiries/settings` (`website:pipeline`): sources, close reasons, message templates, default owner (one person or in turn), first-call target in hours, acknowledgement mail text, seats per class and session, keeping time.
`/app/enquiries/import`: .xlsx/.csv from a fair, dry run with row errors and duplicates, then all-or-nothing.

### 6.4 Public form
Classes come from the school's classes (a section may narrow them); session select when the next year exists; consent line with a link to the privacy page (required); "what happens next" on success, and no reference on the screen (the same words for a first enquiry and for one we already had, so a stranger cannot learn which numbers exist; the reference goes in the thank-you mail, and the office has it); works without JavaScript; honeypot, time trap and rate limits; phone normalised to 10 digits. Same phone and child within 30 days adds to the existing enquiry's timeline instead of a new row (the visitor sees the same success).

### 6.5 Clocks (jobs)
`website.publish-due` 5 min · `website.enquiry-clock` hourly 8 to 18 IST: follow-ups due, first-call target missed (owner, then admins once) · `website.enquiry-retention` daily: closed or not admitted older than the keeping time (default 24 months; admitted ones are kept with the student) are deleted with a count in the audit log (waitlisted and offered children after twice that time, unless somebody closes them; changing the time shows how many would go and asks to confirm) · `website.document-expiry` daily.

## 7. Domains (17)

**States.** `pending → verified → (failing) → verified | failed`, plus `failed → pending` by Check now. Health of a verified domain: ok / warning / broken, with each record's own result: ownership TXT, points-to (CNAME, or A for a bare domain), HTTPS certificate (issuer state and expiry).

| Page | Content |
|---|---|
| `/app/domains` | The free address; each domain with state, health, certificate, main badge and one primary action; add; the redirect rule in words ("school.in and greenvalley.… send visitors to www.school.in") |
| `/app/domains/[id]` | Four steps with each record checked on its own: found value next to expected value; record names in the registrar's short form; guide for the detected DNS provider (GoDaddy, Hostinger, BigRock, Namecheap, Cloudflare with "turn the proxy off", other); *Send to my IT person* (copy or mail); timeline; make main; remove (typed confirm when live) |

- Adding `www.x` offers `x` in one tick, and the other way.
- **Main domain** matters: public pages on any other address of the school redirect (308) to it, keeping path and query; `/app`, `/login`, `/api` never redirect (sessions are per host). Can be turned off per school. Links in mails to families use the main domain when it is healthy, otherwise the free address.
- **Claim.** An unverified claim blocks nobody: several schools may try; the first to prove it by TXT has it, the others are told. Unverified claims end after 30 days.
- **Recheck** every verified domain daily (and every 10 minutes while failing). Broken 24 h: admins get `domain.problem`. Ownership TXT missing 14 days, or pointing elsewhere 30 days: the domain is released (stops serving), the main falls back to the free address, admins are told.
- Downgrade to a plan without custom domains: existing domains keep working, none can be added; the page says so.
- Console: domains list with health, check now, release a claim with reason; each school's domains on its page.

## 8. Settings (18)

`/app/settings` becomes a hub with real pages and a side list (search included): **School** (profile, branding → Theme, academic year → Academics), **People** (users, roles, sign-in activity), **Your data** (audit log, exports, privacy requests, support access, close account), **Modules and plan** (modules, billing), **Communication**, **Finance**, **Website**, **Domain**. Old `?tab=` links redirect.

### 8.1 School profile
Grouped, inline-edited: identity (name, board, affiliation number, school code, UDISE+, type, medium, established year), contact (address, district, city, state, PIN, phone, email, website), head of school (name, qualification), tax (GSTIN), calendar (timezone, year start). PIN checked, state list, GSTIN state must match (warning). Each field says where it is used (receipts, report cards, disclosure, website). Completeness with the missing ones linked.

### 8.2 Users
List (exists) plus: **Add a login** (admin, accountant or any custom role: name, email or phone, role; invite mail or access link), bulk resend invites / disable / sign out, CSV, filters (never signed in, no email, unverified, must change password, custom role, last sign-in older than 60 days).
`/app/settings/users/[id]`: identity, role with **what this person can do** (modules × permissions in words), sign-in state, devices (end one or all), sign-in history, recent actions (audit), links to the staff or student record, and every action now hidden in the Manage dialog. The last admin cannot be disabled or demoted (exists; kept). Nobody changes their own role.

### 8.3 Roles
A page per role: matrix grouped by area with plain words, people in the role, compare with another role, "what changed" from the audit, and a warning before a role loses a permission its people used in the last 30 days.

### 8.4 Sign-in activity
`login_events`: every success, failure, code, support session, with time, IP, device in words, reason. Filters and CSV. A burst of failures on one login (10 in an hour) notifies admins. Sign-in from a new device mails the person (admins and accountants; others may turn it on). Kept 180 days.

### 8.5 Audit log
Each entry opens a side panel: who (and through support), when, where from, what changed field by field (old → new, secrets and medical text never stored), the thing with a link when it still exists, and related entries of the same thing. Filters: module, action, person, support only, record, date, text; in the URL. CSV of the current filter (logged, 50,000 rows). Entries are never edited or deleted; kept for the life of the account.

### 8.6 Exports
Background job: queued → running (tables done) → ready / failed (reason, retry). ZIP with one CSV per table, a `README` and a JSON manifest with row counts; choose modules; private talk and payroll stay opt-in with a reason as today; optional public files. One running export per school. Person picker with search instead of a 1,000-row dropdown. Ready: notification and mail. Link through our route, each download logged; file deleted after 7 days. Not in support sessions. Works when read-only.

### 8.7 Privacy requests
Register of data requests: access, correction, deletion, withdraw consent, complaint. Raised by a family or staff member from **My profile → My data**, or entered by the office. Due date (default 90 days, setting), owner, steps, outcome with reason, documents. Access: one click makes the person's export. Deletion of a student who left: shows what will be blanked and what the school must keep (marks, fees, transfer record), then does it with a typed confirm; an active student cannot be erased. Overdue requests notify. Retention settings in one table: enquiries, sign-in events, exports, messages (link).

### 8.8 Support access
Whether Triakshi may open the school: **always / only when I allow (24 h, 72 h) / never**. Default for existing schools: always (unchanged behaviour), shown clearly. List of every visit: who, reason, when, read-only or not, what they changed (audit). Each visit notifies admins. An owner-level emergency entry is possible with a reason, and is always told to the school.

### 8.9 Modules and account
Modules on your plan with state (in use / never opened / not in plan), what each does, link or "see plans". Close account: what happens and when, export first, typed school name, reason → a `closure` ticket; nothing is deleted by the button.

## 9. Setup (19)

**Wizard** (first run): profile → year → classes → subjects → staff → students → class teachers → website → team (a second admin or office login) → review. Every step: save and continue, skip (optional ones) with "do later", back, resume where left, what it unlocks, 1-line help and **Ask us** (opens a ticket of kind *onboarding* with the step filled in). Prefilled from signup. Staff: paste from a sheet or upload, not only one by one. Students: import or "add five by hand". Class teachers: one screen, a select per section. Two admins can work at once. Required: year and classes.

**Getting started** (`/app/getting-started`, admin, in the menu until complete, always reachable from Settings): every module the school has, grouped: *School*, *People and sign-ins* (staff invited, login slips printed, families who signed in %, second admin), *Daily work* (attendance, timetable, homework), *Exams*, *Money* (from finance's own checklist), *Families* (communication's four), *Website* (published, domain, disclosure), *Safety* (safeguarding lead, support access read). Each task: why, about how long, done from data, button, **give to** a colleague (they get it as a needs-action item and can do it if their role allows), skip with reason, restore. Percent and "next best step". Hidden or shown per school, not per browser.

**Console:** a nightly snapshot per school (percent, stuck step, last sign-in, students, first attendance); schools list column and filter *Stuck* (under 50% after 5 days); school page panel; onboarding tickets link.

## 10. Support (20)

**School.** `/app/support`: help search on top, then my tickets (and all the school's tickets for `support:all`), status banner. Permissions: `support:use` (admin, accountant, teacher by default: own tickets), `support:all` (admin: all). Families ask the school, not us.
- New ticket: category (question, problem, billing, data, onboarding, idea, closure), subject, details, priority in words (Not urgent / Normal / Blocking work / Everything is down), up to 5 files (PDF, image, 10 MB), page and browser caught automatically (shown, removable). Articles matching the subject appear while typing.
- Ticket: number `T-1042`, stage track (Sent, We are on it, Waiting for you, Solved, Closed), expected reply time by priority and plan, thread with files, reply, mark solved, reopen, rate 1–5 with a line after solved. Closed → "Write a follow-up" linking the old one.
- Told: a reply notifies the writer and everyone who wrote in the ticket (`support.reply`: bell, push, mail).
- **Help centre** `/app/support/help`: articles written by us and shipped with the product (so they match the version), by area and role, search, "Was this useful?", related, "Still stuck? Ask us" with the article attached. At least 30 articles covering every module and the six journeys a school asks about most.
- **Status**: notices from us (planned work, problem, solved) as a strip across the panel and on the support page.

**Console.** Queue: search that works (subject, number, school, text), views (new, mine, waiting on us, overdue, waiting on school, solved), SLA clock, category, plan. Ticket: thread with files, internal notes (a separate table the school's database role cannot read), saved replies, assign to anyone, category, priority, solved with a note, school card (plan, status, setup %, open tickets, last sign-in), support access state and *Open the school* when allowed, linked earlier tickets. Reports: volume by category and school, first reply and resolution times, rating. New tickets mail the support address; overdue ones mail the owner.
- Clock job hourly: pending 3 days → reminder to the school; pending 14 days → solved; solved 7 days → closed; first-reply target missed → flag and mail.
- Notices: write, audience (all, plan, one school), from/until, tone, end.

## 11. Home (21)

Each panel is its own server component in its own Suspense with a skeleton of the right size: the greeting and the first row arrive first. Order per role is fixed by importance; a panel with nothing to say shrinks to one line.

| Role | First row | Then |
|---|---|---|
| Admin / principal | Today strip (school day, closures, events, who is away) · needs action · 4 numbers with change (present today vs last 4 same weekdays, collected this month vs last, dues, open enquiries) | attendance week trend with classes not marked · money trend · admissions funnel · requests and approvals · getting started · plan use · staff on leave · birthdays today · notices and events |
| Accountant (and any role with fees) | collected today, dues overdue, approvals waiting, counter state | dues by class, overdue list with call, receipts, cheques to clear, payroll state when held |
| Teacher | now and next period, registers to mark, to grade, marks to enter | my class today (absent with call links, birthdays), meetings, homework due, messages waiting, notices |
| Family | needs your answer · today's classes with now/next · homework due · dues | attendance month, next exam, latest result, meetings, bus, library, notices |
| Any custom role | built from what it holds: front office (enquiries due today, requests, visitors' calls), library (due today, overdue, holds), transport (documents expiring, routes today), HR/payroll, website editor (draft waiting), exam coordinator, timetable (cover needed) | links to its pages, notices |

A panel's data comes from its module's service; home never writes SQL about another module's tables except the counts already listed in the code. Panels show only what the person's permissions allow. Numbers open the list that proves them. Time is IST; on a day off the day says so and work panels change words ("Next school day: Monday"). A new school with no data sees setup, not six empty boxes. No panel takes more than 300 ms at 3,000 students; N+1 loads named in H3 go.

## 12. Permissions (new or changed)
| Grant | Default |
|---|---|
| `website:read`, `website:manage` | admin |
| `website:publish` | admin |
| `website:enquiries` | admin, accountant |
| `website:pipeline` (settings, delete, merge, import, export, reassign) | admin |
| `support:use` | admin, accountant, teacher |
| `support:all` | admin |
| `settings:privacy` (register) | admin only, not delegable |
| `domains:*`, `settings:*`, `setup:*`, `billing:*` | admin only, not delegable (unchanged) |

## 13. Notifications (new topics)
`enquiry.new`, `enquiry.followup` (group work), `domain.problem` (work, priority 3), `support.reply` (work, instant), `account.security` (work, instant, must tell: failed-sign-in bursts, support visits), `export.ready` (work), `privacy.request` (work), `setup.task` (work). Publish requests use `work.approval` and `work.decision`.

## 14. Data
New: `site_versions`, `site_media`, `site_redirects`, `site_page_days`, `site_disclosure`, `enquiry_events`, `enquiry_tasks`, `enquiry_settings`, `enquiry_seats`, `school_domain_events`, `login_events`, `privacy_requests`, `setup_tasks`, `school_setup_status`, `support_files`, `support_notes`, `support_saved_replies`, `support_views` (school visits are `sessions` with `support_staff_id`; the list reads the platform log copy `support_visits`), `platform_notices`.
Changed: `school_sites`, `enquiries`, `school_domains` (unique moves from every row to verified rows), `data_exports`, `support_tickets`, `schools` (profile fields, `support_access`, `support_access_until`, `redirect_to_primary`).
Migration `0013` with hand-written steps: enquiry references and a *created* event for old rows; version 1 from each published site; media rows are filled the first time Media opens; domain unique index swap; ticket numbers for old tickets.

## 15. Non-functional
Isolation test per service; permission tests per role; audit on every write. Public pages: p95 server time under 300 ms, largest image lazy except hero, no layout shift from fonts. Lists paginated. Files: content sniffed, size limited; public files only under `public/site/`. Public posts: rate limit, honeypot, time trap. Never put a family's name or phone in a URL (the admit link carries the enquiry id only). Dates IST. 375 px without sideways scroll. Read-only school: sees everything, changes nothing except exports, tickets and privacy requests.

## 16. Journeys that must work end to end (browser tests)
| # | Journey |
|---|---|
| K1 | Visitor on a phone: home → admissions → enquiry with consent → "we have your enquiry" (no number on screen) → office is told → mail with the reference |
| K2 | Front office: Today → call → book visit → visit → offer → admit → student linked; duplicate merged; another closed with reason; report agrees |
| K3 | Website: edit, reorder, hide, rename address (redirect works), ask to publish as editor role → admin publishes → restore the old version → publish |
| K4 | Two editors on one section: the second is refused with the first one's name |
| K5 | Schedule a publish; the job makes it live; offline and back |
| K6 | Disclosure: fill, upload, publish, public page shows it; expiry warning |
| K7 | Domain: add, records checked one by one (fake DNS), verified, main → redirect and canonical; broken → told; released |
| K8 | Settings: add a second admin → they sign in; user page; sign-in history shows a failed try; role page |
| K9 | Audit: change a student → entry shows old → new → CSV; export runs in the background → downloaded → logged; privacy request from a family → done |
| K10 | Setup: new school through the wizard incl. paste staff and class teachers → getting started → give a task to a colleague → they do it |
| K11 | Support: teacher asks with a file → console sees, notes, replies → teacher is told → solved → rated → reopened; support access off blocks entry; a visit is listed |
| K12 | Home for admin, accountant, cashier, teacher, librarian-type role, front office, family: every number opens a list; crawl finds no dead link; axe passes |

## 17. Not in this build (each with the reason)
| What | Why |
|---|---|
| Two-step sign-in for schools | owner deferred it in AUTH-PRD |
| Online application form with payment, entrance test | a module of its own; parent payment is offline by owner decision |
| Sending WhatsApp or SMS ourselves | waits on DLT / API approval; click-to-chat is built |
| Free HTML, code or third-party scripts on school sites | owner decision (session safety) |
| Buying domains or mailboxes; changing the free address | outside service; by support request |
| Second language of a site | no school has asked; model would change |

## 18. Defaults taken (owner may change any)
Keeping time for enquiries 24 months · first-call target 8 working hours · privacy due date 90 days · exports kept 7 days · sign-in events 180 days · domain release 14 days without TXT, 30 days pointing elsewhere · support reply targets: Everything is down 2 h, Blocking 8 h, Normal 24 h, Not urgent 72 h (working hours 9 to 18, Monday to Saturday) · support access "always" for schools that exist now and for new ones.
