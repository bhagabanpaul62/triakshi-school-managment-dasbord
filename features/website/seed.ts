import { eq, schools, sql, withConsole, withSchool } from "@smw/db";
import type { FeatureSeed } from "@smw/feature-kit";
import { PRESETS } from "@smw/themes";
import { hasTable } from "./enquiry-core";
import { EnquiryService, EnquirySettingsService, SiteService, SiteSettingsService } from "./service";

const COPY: Record<string, { heading: string; sub: string; about: string }> = {
  greenvalley: {
    heading: "Where Bengaluru's children learn to love learning",
    sub: "Small classes, kind teachers and a green campus on MG Road. CBSE from Nursery to Class 10.",
    about: "Green Valley began in 1999 with forty children and one borrowed classroom. Today twelve hundred students walk through our gates, and we still know every one of them by name.\n\n## What we believe\n\nMarks matter, and so does confidence. We keep homework light, reading heavy and playtime sacred.",
  },
  sunrise: {
    heading: "A new day in learning, every day",
    sub: "An ICSE school in Pune with strong languages, a busy music room and a very loud football team.",
    about: "Sunrise International School opened its doors to a first batch of ninety children. We grew by listening to parents and by never saying no to a good idea from a teacher.\n\n## How we teach\n\nProjects over cramming. Every term each class presents something real to the whole school.",
  },
};

interface Seeded {
  studentName: string; parentName: string; phone: string; classApplying: string; dob: string; message?: string; source: string; campaign?: string; kind?: "question";
  /** What happened to it, in order. */
  story: ("call" | "visit" | "visited" | "applied" | "offered" | "waitlist" | "admitted" | "closed" | "unowned")[];
}
const ENQUIRIES: Seeded[] = [
  { studentName: "Aarav Nair", parentName: "Suresh Nair", phone: "9845012345", classApplying: "Class 1", dob: "2019-03-14", message: "We are moving from Kochi in April. Is a seat available?", source: "website", story: ["unowned"] },
  { studentName: "Ananya Deshpande", parentName: "Kavita Deshpande", phone: "9822098220", classApplying: "Nursery", dob: "2022-08-02", source: "social", campaign: "instagram / admissions", story: ["unowned"] },
  { studentName: "Rohan Malhotra", parentName: "Neha Malhotra", phone: "9811122334", classApplying: "Class 4", dob: "2016-11-21", message: "Please share the fee structure and bus routes.", source: "website", story: ["call", "visit"] },
  { studentName: "Ishita Reddy", parentName: "Venkat Reddy", phone: "9900011122", classApplying: "LKG", dob: "2021-01-30", source: "phone", story: ["call", "visit", "visited"] },
  { studentName: "Neel Kapoor", parentName: "Anju Kapoor", phone: "9810055566", classApplying: "Class 2", dob: "2018-04-19", source: "fair", story: ["call", "visit", "visited", "applied"] },
  { studentName: "Kabir Sheikh", parentName: "Farah Sheikh", phone: "9876501234", classApplying: "Class 6", dob: "2014-06-09", source: "referral", story: ["call", "visit", "visited", "applied", "offered", "admitted"] },
  { studentName: "Sana Qureshi", parentName: "Imran Qureshi", phone: "9833344455", classApplying: "Class 1", dob: "2019-09-02", source: "walk-in", story: ["call", "visited", "applied", "offered"] },
  { studentName: "Tanvi Joshi", parentName: "Mahesh Joshi", phone: "9822211133", classApplying: "Class 4", dob: "2016-02-11", source: "phone", story: ["call", "waitlist"] },
  { studentName: "Diya Menon", parentName: "Rajesh Menon", phone: "9447012345", classApplying: "Class 2", dob: "2018-12-05", message: "Looking for a school closer to Whitefield.", source: "website", story: ["call", "closed"] },
  { studentName: "General question", parentName: "Pooja Verma", phone: "9811199988", classApplying: "", dob: "", message: "Do you run a summer camp?", source: "website", kind: "question", story: ["unowned"] },
];

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).slice(0, 16).replace(" ", "T");

/** A published website in the school's preset, and ten enquiries across the pipeline, with calls, visits, owners, sources and seats. */
/** A student with no enquiry behind them, so one demo family can show "admitted from an enquiry". Null when the school has no students yet. */
async function freeStudent(schoolId: string): Promise<string | null> {
  return withSchool(schoolId, async (tx) => {
    if (!(await hasTable(tx, "students"))) return null;
    const [r] = [...(await tx.execute(sql`select id from students where status = 'active' and id not in (select converted_student_id from enquiries where converted_student_id is not null) order by created_at desc limit 1`))] as { id: string }[];
    return r?.id ?? null;
  });
}

const seed: FeatureSeed = async (ctx, state) => {
  const slug = String(state.slug ?? "");
  const copy = COPY[slug] ?? COPY.greenvalley!;
  const preset = PRESETS[slug === "sunrise" ? "maroon" : "ocean"]!;
  // The theme goes straight in: the demo "starter" school is on a plan that limits the editor, but its demo theme is a preset.
  await withConsole((tx) => tx.update(schools).set({ theme: preset as unknown as Record<string, unknown> }).where(eq(schools.id, ctx.schoolId)));

  const site = new SiteService(ctx);
  const draft = (await site.get()).draft;
  const home = draft.pages.find((p) => p.slug === "home")!;
  const about = draft.pages.find((p) => p.slug === "about")!;
  const hero = home.sections[0]!;
  await site.updateSection("home", hero.id, { ...hero.data, heading: copy.heading, subheading: copy.sub, ctaLabel: "Apply for admission", ctaHref: "/admissions" });
  const story = about.sections.find((s) => s.type === "rich_text")!;
  await site.updateSection("about", story.id, { ...story.data, heading: "Our story", body: copy.about });
  await site.setTemplate(slug === "sunrise" ? "modern" : "classic");
  // The demo school has looked at its teachers list (nobody is named on the website until that is done).
  await new SiteSettingsService(ctx).update({ hiddenStaff: [] });
  await site.publish();

  const svc = new EnquiryService(ctx);
  const spare = await freeStudent(ctx.schoolId);
  const session = (await svc.options()).session;
  await new EnquirySettingsService(ctx).saveSeats(session, { rows: [["Nursery", 30], ["LKG", 30], ["Class 1", 2], ["Class 2", 40], ["Class 4", 40], ["Class 6", 40]].map(([className, seats]) => ({ session, className, seats })) });
  for (const e of ENQUIRIES) {
    const row = await svc.create({
      studentName: e.studentName, parentName: e.parentName, phone: e.phone, classApplying: e.classApplying || undefined, dob: e.dob || undefined, message: e.message,
      source: e.source, campaign: e.campaign, kind: e.kind ?? "admission", nextKind: "call", nextOn: hoursFromNow(20),
    });
    const id = row.id;
    for (const step of e.story) {
      if (step === "unowned") await svc.assign(id, null);
      else if (step === "call") await svc.logCall(id, { outcome: "talked", note: "Explained the admission process." });
      else if (step === "visit") await svc.bookVisit(id, { at: hoursFromNow(e.story.includes("visited") ? 1 : 30), note: "Campus tour" });
      else if (step === "visited") {
        if (!e.story.includes("visit")) await svc.moveTo(id, { to: "visit" });
        await svc.recordVisit(id, { note: "Liked the library." });
      } else if (step === "closed") await svc.moveTo(id, { to: "closed", reason: "Chose another school" });
      else if (step === "admitted") { if (spare) await svc.markAdmitted(id, spare); else await svc.moveTo(id, { to: "offered" }); }
      else await svc.moveTo(id, { to: step });
    }
  }
};
export default seed;
