import { IconBook, IconBooks, IconBell, IconBus, IconCalendarEvent, IconCalendarStats, IconCertificate, IconChecklist, IconClockHour4, IconCurrencyRupee, IconDownload, IconHistory, IconInbox, IconKey, IconLayoutGrid, IconLifebuoy, IconLink, IconMessageCircle, IconNotebook, IconPalette, IconSpeakerphone, IconUserPlus, IconUsers, IconWorldWww } from "@tabler/icons-react";
import type { Tint } from "./ui";

export type Role = "Admin" | "Teacher" | "Accountant" | "Parent" | "Student" | "Office staff";
export type Mod = { name: string; icon: typeof IconBook; line: string; bullets: string[]; who: Role[] };
export type Group = { name: string; line: string; tint: Tint; mods: Mod[] };

export const GROUPS: Group[] = [
  {
    name: "Academics", line: "The structure the rest of the school hangs on.", tint: "sky",
    mods: [
      { name: "Classes & sections", icon: IconLayoutGrid, line: "Every class and section, with its class teacher.", bullets: ["Sections under each class", "A class teacher for each section", "Promote a class to the next each April"], who: ["Admin", "Teacher"] },
      { name: "Subjects", icon: IconBook, line: "Which subjects each class studies, and who teaches them.", bullets: ["Subjects set per class", "A teacher assigned to each subject", "Feeds the timetable, homework and exams"], who: ["Admin", "Teacher"] },
      { name: "Academic years & terms", icon: IconCalendarStats, line: "April to March, with terms inside the year.", bullets: ["One current year at a time", "Terms for exams and fees", "Earlier years stay readable"], who: ["Admin"] },
      { name: "Timetable", icon: IconClockHour4, line: "A bell schedule and a weekly plan with no clashes.", bullets: ["Bell schedule of periods", "Teacher load at a glance", "Clash check for teachers and rooms"], who: ["Admin", "Teacher", "Student", "Parent"] },
    ],
  },
  {
    name: "People", line: "Everyone in the school, each with the right login.", tint: "green",
    mods: [
      { name: "Students & admissions", icon: IconUserPlus, line: "One profile per student, from admission onwards.", bullets: ["Guardians and contact details", "Documents kept on the profile", "Import your existing list from a spreadsheet"], who: ["Admin", "Office staff"] },
      { name: "Staff & roles", icon: IconUsers, line: "Invite teachers and office staff, and give each a role.", bullets: ["Invite by email", "The role decides what each person sees", "Deactivate when someone leaves"], who: ["Admin"] },
      { name: "Family logins", icon: IconKey, line: "One login per student, shared by the family, on the phone they already have.", bullets: ["The family sees only their own child", "Homework, attendance, results and fees in one place", "Runs in the browser, nothing to install"], who: ["Parent", "Student"] },
    ],
  },
  {
    name: "Classroom", line: "The work of every school day.", tint: "cream",
    mods: [
      { name: "Attendance", icon: IconChecklist, line: "Mark a class in seconds. Present is the default.", bullets: ["Tap only the absentees", "Parents told the same morning", "Leave requests next to the register"], who: ["Teacher", "Admin", "Parent"] },
      { name: "Assignments", icon: IconNotebook, line: "Homework goes out, work comes in, marks go back.", bullets: ["Post homework for a class", "Students hand in their work", "Teachers grade and comment"], who: ["Teacher", "Student", "Parent"] },
      { name: "Exams & report cards", icon: IconCertificate, line: "From marks entry to a report card, without a spreadsheet.", bullets: ["Marks entry per subject", "Grade scales you can edit", "Report cards as PDF"], who: ["Teacher", "Admin", "Parent", "Student"] },
    ],
  },
  {
    name: "Fees & campus", line: "Money, buses and books.", tint: "rose",
    mods: [
      { name: "Fees", icon: IconCurrencyRupee, line: "Parents pay the way they do today. The office records it.", bullets: ["Fee structures and instalments", "Cash, UPI or cheque, with numbered receipts", "Dues list and reminders"], who: ["Accountant", "Admin", "Parent"] },
      { name: "Transport", icon: IconBus, line: "Routes, stops and who rides each bus.", bullets: ["Routes and stops", "Students on each bus", "Transport fee tied to the route"], who: ["Admin", "Accountant", "Parent"] },
      { name: "Library", icon: IconBooks, line: "Your books, and who has them.", bullets: ["Book catalogue", "Issue and return", "See what is overdue"], who: ["Office staff", "Teacher", "Student"] },
    ],
  },
  {
    name: "Communication", line: "The right message to the right people.", tint: "lilac",
    mods: [
      { name: "Announcements", icon: IconSpeakerphone, line: "A notice to a class, a section or the whole school.", bullets: ["Pick who should get it", "Pin the important ones", "Parents read it in their login"], who: ["Admin", "Teacher", "Parent", "Student"] },
      { name: "Messages", icon: IconMessageCircle, line: "Talk to a parent or teacher without sharing phone numbers.", bullets: ["One thread per conversation", "Kept on the school's record", "Replies in the same place"], who: ["Teacher", "Parent", "Admin"] },
      { name: "Notifications", icon: IconBell, line: "A nudge when something needs a look.", bullets: ["Absent today, fee due, new homework", "Shown inside the app", "Each person sees only their own"], who: ["Parent", "Teacher", "Student", "Admin"] },
      { name: "Events calendar", icon: IconCalendarEvent, line: "Holidays, exams and meetings on one calendar.", bullets: ["Holidays and exam dates", "Parent-teacher meetings", "One calendar for everyone"], who: ["Admin", "Teacher", "Parent", "Student"] },
    ],
  },
  {
    name: "Website", line: "How new families find you.", tint: "mint",
    mods: [
      { name: "Website builder", icon: IconWorldWww, line: "A public school site from ready templates.", bullets: ["Pick a template", "Edit pages, photos and notices", "Publish when you are ready"], who: ["Admin", "Office staff"] },
      { name: "Your own domain", icon: IconLink, line: "Your site on an address you already own.", bullets: ["Use a name you already own", "Or start on our address", "Move to your own any time"], who: ["Admin"] },
      { name: "Admission enquiries", icon: IconInbox, line: "Enquiries from your site land in your dashboard.", bullets: ["One inbox for every enquiry", "Parent's name, class and phone", "Follow up from the same screen"], who: ["Admin", "Office staff"] },
    ],
  },
  {
    name: "Office", line: "Control, records and help.", tint: "stone",
    mods: [
      { name: "Settings & branding", icon: IconPalette, line: "Your school's name, colour and logo, everywhere.", bullets: ["Logo and school colour", "Receipts and report cards carry them", "Roles and who can do what"], who: ["Admin"] },
      { name: "Audit log", icon: IconHistory, line: "A record of who changed what, and when.", bullets: ["Every change is recorded", "Filter by person or date", "Settles the 'who did this' question"], who: ["Admin"] },
      { name: "Data export", icon: IconDownload, line: "Your data is yours. Take it out any time.", bullets: ["Export to spreadsheet files", "Works during the read-only period too", "No lock-in"], who: ["Admin"] },
      { name: "Support", icon: IconLifebuoy, line: "A person to ask when you are stuck.", bullets: ["Ask from inside the app", "Setup help for a new school", "Replies by email"], who: ["Admin", "Office staff"] },
    ],
  },
];

export const MODULE_COUNT = GROUPS.reduce((n, g) => n + g.mods.length, 0);
