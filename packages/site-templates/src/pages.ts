/** Ready-made pages a school can start from, and the default site of a new school. Pure (no React). */
import { HOME_SLUG, SECTION_META, mk, type Page, type Section, type SectionData, type SiteContent, type SchoolInfo } from "./content";

export const PAGE_TEMPLATE_KEYS = ["blank", "about", "academics", "admissions", "fees", "facilities", "gallery", "news", "contact", "disclosure", "documents"] as const;
export type PageTemplateKey = (typeof PAGE_TEMPLATE_KEYS)[number];

interface PageTemplate {
  name: string; description: string;
  /** Suggested address and title; the school can change both. */
  slug: string; title: string;
  build: (s: SchoolInfo) => { intro?: string; seo: Page["seo"]; sections: Section[] };
}

const photo = (id: string) => `https://images.unsplash.com/photo-${id}?w=1200&q=70`;
/** Sample photos for starter pages. Each caption says so, so a school replaces them before publishing. */
const SAMPLE = {
  classroom: photo("1580582932707-520aed937b7b"), teacher: photo("1577896851231-70ef18881754"), library: photo("1481627834876-b7833e8f5570"),
  sports: photo("1461896836934-ffe607ba8211"), lab: photo("1532094349884-543bc11b234d"), art: photo("1513364776144-60967b0f800f"),
};
const admissionForm = (heading: string) => mk("admission_form", { ...(SECTION_META.admission_form.initial as SectionData<"admission_form">), heading });
const visitCta = () => mk("cta", { heading: "Come and see the school", text: "Book a visit. We will show you around and answer every question.", ctaLabel: "Apply for admission", ctaHref: "/admissions" });

export const PAGE_TEMPLATES: Record<PageTemplateKey, PageTemplate> = {
  blank: { name: "Blank page", description: "An empty page. Add your own sections.", slug: "new-page", title: "New page", build: () => ({ seo: {}, sections: [] }) },
  about: {
    name: "About us", description: "Your story, what you stand for, the principal's message, teachers and parent voices.", slug: "about", title: "About us",
    build: (s) => ({
      intro: "Who we are, what we believe and the people who teach here.",
      seo: { title: `About ${s.name}`, description: `Our story, values and the teachers behind ${s.name}.` },
      sections: [
        mk("rich_text", { heading: "Our story", body: `${s.name} began with a simple idea: a good school is one where children feel safe enough to ask questions.\n\nWe keep classes small, we know every family, and we measure success by confidence as much as by marks.` }),
        mk("features", { heading: "What we stand for", items: [
          { title: "Our vision", text: "Children who think for themselves, care for others and enjoy learning for life." },
          { title: "Our mission", text: "Strong basics, kind teachers and time for play, every single day." },
          { title: "Our values", text: "Honesty, respect, hard work and curiosity, in class and on the playground." },
        ] }),
        mk("image_text", { heading: "From the principal's desk", body: "Every child who walks through our gate brings a different story. Our job is to listen first, then teach.\n\nI invite you to visit us, sit in a class and see how our children learn.", role: "Principal", side: "right" }),
        mk("staff", { heading: "Meet our teachers", limit: 8 }),
        mk("testimonials", { heading: "What parents say", items: [
          { name: "Sunita Verma", role: "Parent of Class 4 student", quote: "The teachers actually call me when something is wrong, and also when something is right. That means a lot." },
          { name: "Arjun Mehta", role: "Parent of Class 7 student", quote: "My son enjoys going to school again. His maths has improved without any extra pressure." },
        ] }),
        visitCta(),
      ],
    }),
  },
  academics: {
    name: "Academics", description: "Stages of learning, how you teach, activities beyond class and school timings.", slug: "academics", title: "Academics",
    build: (s) => ({
      intro: `What children learn at ${s.name}, and how we teach it.`,
      seo: { title: `Academics at ${s.name}`, description: `Curriculum, teaching approach, activities and timings at ${s.name}.` },
      sections: [
        mk("features", { heading: "Stages of learning", intro: `${s.board ? `We follow the ${s.board} curriculum. ` : ""}Each stage builds on the one before.`, items: [
          { title: "Pre-primary", text: "Nursery to UKG. Learning through play, stories, rhymes and lots of hands-on activity." },
          { title: "Primary classes", text: "Class 1 to 5. Strong reading, writing and number skills, with EVS, art and games." },
          { title: "Middle classes", text: "Class 6 to 8. Science labs, computers, a third language and project work." },
          { title: "Secondary classes", text: "Class 9 and 10. Careful board preparation with regular tests and doubt classes." },
        ] }),
        mk("rich_text", { heading: "How we teach", body: "We explain the idea first, practise it together, then let children try on their own. Homework is light and has a purpose.\n\n## Checking progress\n\nShort class tests every few weeks, two term exams, and a parent-teacher meeting after each one. You can see marks and attendance in the parent login at any time." }),
        mk("features", { heading: "Beyond the classroom", items: [
          { title: "Sports and games", text: "Cricket, football, athletics, kho-kho and yoga with trained coaches." },
          { title: "Music, dance and art", text: "Weekly periods for every class and a stage for every child on Annual Day." },
          { title: "Clubs and competitions", text: "Science, reading, quiz and eco clubs, plus olympiads and inter-school events." },
        ] }),
        mk("table", SECTION_META.table.initial as SectionData<"table">),
        visitCta(),
      ],
    }),
  },
  admissions: {
    name: "Admissions", description: "The steps to apply, age rules, documents, common questions and the enquiry form.", slug: "admissions", title: "Admissions",
    build: (s) => ({
      intro: "Everything you need to apply, in one place.",
      seo: { title: `Admissions at ${s.name}`, description: `How to apply to ${s.name}: steps, age criteria, documents and the enquiry form.` },
      sections: [
        mk("steps", { ...(SECTION_META.steps.initial as SectionData<"steps">), heading: "How to apply" }),
        mk("table", { heading: "Age criteria", intro: "Age as on 31 March of the year of admission.", columns: ["Class", "Minimum age"], rows: [["Nursery", "3 years"], ["LKG", "4 years"], ["UKG", "5 years"], ["Class 1", "6 years"]], note: "For higher classes, admission depends on seats and the previous report card." }),
        mk("rich_text", { heading: "Documents we ask for", body: "- Birth certificate of the child\n- Two passport size photographs\n- Aadhaar card of the child and one parent\n- Previous report card and transfer certificate (Class 2 onwards)\n- Address proof of a parent" }),
        mk("faq", { heading: "Common questions", items: [
          { q: "When do admissions open?", a: "Enquiries are open all year. New sessions start in April. Mid-year admission depends on seats." },
          { q: "Is there an entrance test?", a: "There is no test up to Class 1. From Class 2, we do a short, friendly check in English and Maths." },
          { q: "Can we visit before applying?", a: "Yes, please do. Send an enquiry and the office will fix a time that suits you." },
          { q: "Do you have a school bus?", a: "Yes. Ask the office for the routes and bus fee for your area." },
        ] }),
        admissionForm("Send an enquiry"),
      ],
    }),
  },
  fees: {
    name: "Fees", description: "A clear fee table, how and when to pay, and common fee questions.", slug: "fees", title: "Fee structure",
    build: (s) => ({
      intro: "Clear fees, with no hidden charges.",
      seo: { title: `Fee structure of ${s.name}`, description: `Tuition and other fees at ${s.name}, with payment dates and options.` },
      sections: [
        mk("table", { heading: "Fees for this session", intro: "Replace these sample amounts with your own.", columns: ["Class", "Admission fee (once)", "Tuition fee (per month)", "Annual charges"], rows: [["Nursery to UKG", "₹ 0", "₹ 0", "₹ 0"], ["Class 1 to 5", "₹ 0", "₹ 0", "₹ 0"], ["Class 6 to 8", "₹ 0", "₹ 0", "₹ 0"], ["Class 9 and 10", "₹ 0", "₹ 0", "₹ 0"]], note: "Transport and uniform are charged separately." }),
        mk("features", { heading: "Paying fees", items: [
          { title: "Pay online", text: "Parents can pay by UPI, card or net banking from the parent login and get a receipt at once." },
          { title: "Pay at the office", text: "Cash or cheque at the fee counter on any working day." },
          { title: "Due dates", text: "Fees are due by the 10th of each month or each quarter, as you choose." },
        ] }),
        mk("faq", { heading: "Fee questions", items: [
          { q: "Is there a sibling discount?", a: "Yes. Ask the office for the current concession." },
          { q: "Is the admission fee refundable?", a: "No. The admission fee is paid once and is not refundable." },
        ] }),
        visitCta(),
      ],
    }),
  },
  facilities: {
    name: "Facilities", description: "Classrooms, library, labs, sports, transport and safety, with photos.", slug: "facilities", title: "Facilities",
    build: (s) => ({
      intro: "A safe, well-kept campus with room to learn and play.",
      seo: { title: `Facilities at ${s.name}`, description: `Classrooms, library, labs, sports, transport and safety at ${s.name}.` },
      sections: [
        mk("features", { heading: "On our campus", items: [
          { title: "Smart classrooms", text: "Bright, airy rooms with digital boards and comfortable seating." },
          { title: "Library", text: "Thousands of books and a weekly reading period for every class." },
          { title: "Science and computer labs", text: "Well-equipped labs where children do the experiment themselves." },
          { title: "Sports ground", text: "A large playground with courts and trained coaches." },
          { title: "School transport", text: "GPS-tracked buses with a lady attendant on every route." },
          { title: "Safety and security", text: "CCTV, verified staff, a guard at every gate and a first-aid room." },
        ] }),
        mk("gallery", { heading: "A look around", images: [
          { url: SAMPLE.classroom, caption: "Sample photo. Replace with your classroom" }, { url: SAMPLE.library, caption: "Sample photo. Replace with your library" }, { url: SAMPLE.lab, caption: "Sample photo. Replace with your lab" },
        ] }),
        visitCta(),
      ],
    }),
  },
  gallery: {
    name: "Photo gallery", description: "Photo grids for campus life and events.", slug: "gallery", title: "Gallery",
    build: (s) => ({
      intro: "Moments from our classrooms, playground and stage.",
      seo: { title: `Photo gallery of ${s.name}`, description: `Photos of campus life and events at ${s.name}.` },
      sections: [
        mk("gallery", { heading: "Campus life", images: [
          { url: SAMPLE.classroom, caption: "Sample photo. Replace with your own" }, { url: SAMPLE.teacher, caption: "Sample photo. Replace with your own" }, { url: SAMPLE.library, caption: "Sample photo. Replace with your own" },
        ] }),
        mk("gallery", { heading: "Sports and events", images: [
          { url: SAMPLE.sports, caption: "Sample photo. Replace with your own" }, { url: SAMPLE.art, caption: "Sample photo. Replace with your own" }, { url: SAMPLE.lab, caption: "Sample photo. Replace with your own" },
        ] }),
      ],
    }),
  },
  news: {
    name: "News and events", description: "Your public announcements and upcoming events, filled in automatically. It takes the address /news, so it replaces the plain notices page the site makes by itself.", slug: "news", title: "News and events",
    build: (s) => ({
      intro: "Notices, circulars and what is coming up.",
      seo: { title: `News and events at ${s.name}`, description: `Latest notices and upcoming events at ${s.name}.` },
      sections: [mk("news", { heading: "Latest notices", limit: 12 }), mk("events", { heading: "Upcoming events", limit: 12 })],
    }),
  },
  contact: {
    name: "Contact", description: "Address, phone, map, questions before a visit and a call to apply.", slug: "contact", title: "Contact us",
    build: (s) => ({
      intro: "Call, write or walk in. The office is happy to help.",
      seo: { title: `Contact ${s.name}`, description: `Address, phone, email, office hours and map for ${s.name}.` },
      sections: [
        mk("contact", { heading: "Visit us", address: [s.address, s.city].filter(Boolean).join(", ") || s.name, phone: s.phone ?? undefined, email: s.email ?? undefined, hours: "Monday to Saturday, 8 am to 3 pm" }),
        mk("faq", { heading: "Before you visit", items: [
          { q: "Do we need an appointment?", a: "For admissions, please send an enquiry or call first so someone is free to show you around. For anything else, walk in during office hours." },
          { q: "Who do we meet for admissions?", a: "Ask for the admissions desk at the front office." },
          { q: "Is there parking?", a: "Yes, visitor parking is available near the main gate." },
        ] }),
        visitCta(),
      ],
    }),
  },
  disclosure: {
    name: "Mandatory public disclosure", description: "The disclosure page in five parts: general information, documents, results, staff and infrastructure. Fill it in under Website, Disclosure.", slug: "disclosure", title: "Mandatory public disclosure",
    build: (s) => ({
      intro: "Information published as required by the board.",
      seo: { title: `Mandatory public disclosure | ${s.name}`, description: `Mandatory public disclosure of ${s.name}.` },
      sections: [mk("disclosure", { heading: "Mandatory public disclosure", data: { values: {} } })],
    }),
  },
  documents: {
    name: "Documents and downloads", description: "Prospectus, circulars, fee notices and certificates, grouped, with date and size.", slug: "documents", title: "Documents",
    build: (s) => ({
      intro: `Forms, notices and certificates from ${s.name}.`,
      seo: { title: `Documents | ${s.name}`, description: `Download the prospectus, circulars and forms of ${s.name}.` },
      sections: [mk("documents", { heading: "Documents and downloads", intro: "Replace these with your own files. Upload them under Website, Media.", items: [
        { label: "Prospectus", url: "https://example.org/prospectus.pdf", group: "Admissions" },
        { label: "Fee structure", url: "https://example.org/fees.pdf", group: "Fees" },
        { label: "Academic calendar", url: "https://example.org/calendar.pdf", group: "Academics" },
      ] })],
    }),
  },
};

/** A page from a template, filled with the school's own details. */
export function buildPage(key: PageTemplateKey, school: SchoolInfo, over: { slug?: string; title?: string } = {}): Page {
  const t = PAGE_TEMPLATES[key];
  return { slug: over.slug ?? t.slug, title: over.title ?? t.title, ...t.build(school) };
}

/** The starting website of a new school: Home, About, Academics, Admissions, Contact (five pages, the smallest plan's limit). */
export function defaultSite(school: SchoolInfo, now = new Date()): SiteContent {
  const where = school.city ? ` in ${school.city}` : "";
  const board = school.board ? `${school.board} ` : "";
  const home: Page = {
    slug: HOME_SLUG, title: "Home",
    seo: { title: `${school.name}${school.city ? `, ${school.city}` : ""}`, description: `${school.name} is a ${board}school${where}. See news, events and how to apply.` },
    sections: [
      mk("hero", { eyebrow: `${board}school${where}`.replace(/^./, (c) => c.toUpperCase()), heading: `Welcome to ${school.name}`, subheading: `A caring ${board}school${where}, where every child is known by name and challenged to grow.`, ctaLabel: "Apply for admission", ctaHref: "/admissions", cta2Label: "Book a visit", cta2Href: "/contact" }),
      mk("stats", { items: [{ value: "1,200+", label: "Students" }, { value: "60", label: "Teachers" }, { value: "25", label: "Years of teaching" }, { value: "98%", label: "Board pass rate" }] }),
      mk("features", { heading: "Why families choose us", items: [
        { title: "Small classes", text: "Every teacher knows every child, so nobody is left behind." },
        { title: "Caring teachers", text: "Trained, patient staff who call you with good news too." },
        { title: "Sports every day", text: "A games period for every class, with trained coaches." },
        { title: "Safe campus", text: "CCTV, verified staff and a guard at every gate." },
        { title: "Smart classrooms", text: "Digital boards, a stocked library and working labs." },
        { title: "School transport", text: "GPS-tracked buses with an attendant on every route." },
      ] }),
      mk("image_text", { heading: "From the principal's desk", body: "Every child who walks through our gate brings a different story. Our job is to listen first, then teach.\n\nI invite you to visit us, sit in a class and see how our children learn.", role: "Principal", side: "right" }),
      mk("news", { heading: "News and notices", limit: 3 }),
      mk("events", { heading: "Upcoming events", limit: 3 }),
      mk("testimonials", { heading: "What parents say", items: [
        { name: "Sunita Verma", role: "Parent of Class 4 student", quote: "The teachers actually call me when something is wrong, and also when something is right. That means a lot." },
        { name: "Arjun Mehta", role: "Parent of Class 7 student", quote: "My son enjoys going to school again. His maths has improved without any extra pressure." },
      ] }),
      visitCta(),
    ],
  };
  const keys = ["about", "academics", "admissions", "contact"] as const;
  return {
    pages: [home, ...keys.map((k) => buildPage(k, school))],
    nav: [{ label: "About", slug: "about" }, { label: "Academics", slug: "academics" }, { label: "Admissions", slug: "admissions" }, { label: "Contact", slug: "contact" }],
    footer: { text: `© ${now.getFullYear()} ${school.name}. All rights reserved.`, links: [{ label: "Staff sign in", href: "/login" }] },
  };
}
