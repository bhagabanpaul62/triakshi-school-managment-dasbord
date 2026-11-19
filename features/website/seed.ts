import { eq, schools, withConsole } from "@smw/db";
import type { FeatureSeed } from "@smw/feature-kit";
import { PRESETS } from "@smw/themes";
import { EnquiryService, SiteService } from "./service";

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

const ENQUIRIES: { studentName: string; parentName: string; phone: string; classApplying: string; dob: string; message?: string; source: string; status: "new" | "contacted" | "visited" | "admitted" | "closed"; notes?: string }[] = [
  { studentName: "Aarav Nair", parentName: "Suresh Nair", phone: "9845012345", classApplying: "Class 1", dob: "2019-03-14", message: "We are moving from Kochi in April. Is a seat available?", source: "website", status: "new" },
  { studentName: "Ananya Deshpande", parentName: "Kavita Deshpande", phone: "9822098220", classApplying: "Nursery", dob: "2022-08-02", source: "website", status: "new" },
  { studentName: "Rohan Malhotra", parentName: "Neha Malhotra", phone: "9811122334", classApplying: "Class 4", dob: "2016-11-21", message: "Please share the fee structure and bus routes.", source: "website", status: "contacted", notes: "Called on Monday. Will visit on Saturday." },
  { studentName: "Ishita Reddy", parentName: "Venkat Reddy", phone: "9900011122", classApplying: "LKG", dob: "2021-01-30", source: "phone", status: "visited", notes: "Liked the library. Waiting for the sibling discount answer." },
  { studentName: "Kabir Sheikh", parentName: "Farah Sheikh", phone: "9876501234", classApplying: "Class 6", dob: "2014-06-09", source: "referral", status: "admitted", notes: "Documents received. Admission form signed." },
  { studentName: "Diya Menon", parentName: "Rajesh Menon", phone: "9447012345", classApplying: "Class 2", dob: "2018-12-05", message: "Looking for a school closer to Whitefield.", source: "website", status: "closed", notes: "Chose a school nearer home." },
];

/** A published website in the school's preset, and six enquiries across the pipeline. */
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
  await site.publish();

  const svc = new EnquiryService(ctx);
  for (const e of ENQUIRIES) {
    const row = await svc.create({ studentName: e.studentName, parentName: e.parentName, phone: e.phone, classApplying: e.classApplying, dob: e.dob, message: e.message, source: e.source });
    if (e.status !== "new" || e.notes) await svc.update(row.id, { status: e.status, notes: e.notes });
  }
};
export default seed;
