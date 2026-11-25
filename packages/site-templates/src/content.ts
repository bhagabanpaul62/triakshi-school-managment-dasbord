/**
 * The content model of a school website: pages, sections, nav and footer, with zod schemas,
 * and what each section type is called and starts as. Pure (no React).
 */
import { z } from "zod";
import { disclosureSchema } from "./disclosure";

export const RESERVED_SLUGS = ["app", "login", "api", "_next", "support-login", "reset-password", "verify-email"] as const;
/** Taken by the app too, refused only for new pages: a stored site that already uses one must stay valid. */
export const RESERVED_NEW_SLUGS = ["confirm-email", "forgot-password", "unsubscribe", "verify", "privacy", "enquiry-sent"] as const;
export const HOME_SLUG = "home";
export const TEMPLATE_KEYS = ["classic", "modern", "minimal", "campus", "playful"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export const TEMPLATES: Record<TemplateKey, { name: string; description: string }> = {
  classic: { name: "Classic", description: "Serif headings, a centred header and deep colour bands. Feels established." },
  modern: { name: "Modern", description: "Bold sans headings, soft cards and a pill menu. Feels fresh and friendly." },
  minimal: { name: "Minimal", description: "Quiet, text-first, lots of white space. Lets your photos and words lead." },
  campus: { name: "Campus", description: "A full-width campus photo, strong colour bands and a dark footer. Feels like a big institution." },
  playful: { name: "Playful", description: "Rounded shapes, warm colour blocks and chunky buttons. Feels cheerful, made for younger children." },
};

export const SECTION_TYPES = ["hero", "rich_text", "stats", "gallery", "news", "events", "staff", "testimonials", "admission_form", "contact", "features", "steps", "image_text", "faq", "table", "links", "cta", "video", "documents", "people", "achievers", "contact_form", "disclosure"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

// ---------- field schemas ----------

/** Only http(s): a `javascript:` link must never reach an href or src. */
const link = z.string().trim().regex(/^(\/(?![/\\])[^\s\\]*|https?:\/\/[^\s]+)$/i, "Use a page like /admissions or a full https:// link").max(500);
/** A photo: a full https link, or a file uploaded to this school's public storage. */
const imageSrc = z.string().trim().regex(/^(https?:\/\/[^\s]+|\/api\/files\/[^\s\\]+)$/i, "Upload a photo, or use a full link starting with https://").max(500);
/** A document: a full https link, or a file uploaded to this school's public storage. */
const fileSrc = z.string().trim().regex(/^(https?:\/\/[^\s]+|\/api\/files\/[^\s\\]+)$/i, "Upload a file, or use a full link starting with https://").max(500);
/** Only the two players we can draw without their scripts until a click. */
export const VIDEO_LINK = /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)[\w-]{6,20}|youtu\.be\/[\w-]{6,20}|vimeo\.com\/\d{6,12})([?&#][^\s]*)?$/i;
const line = (max: number, msg = "Required") => z.string().trim().min(1, msg).max(max);
const opt = (max: number) => z.string().trim().max(max).optional();

export const slugSchema = z.string().trim().toLowerCase().min(1, "Give the page a web address").max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes, like our-story")
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), "This address is reserved by the system. Pick another.");

export const SECTION_DATA = {
  hero: z.object({ eyebrow: opt(60), heading: line(120, "Write a headline"), subheading: opt(300), ctaLabel: opt(40), ctaHref: link.optional(), cta2Label: opt(40), cta2Href: link.optional(), imageUrl: imageSrc.optional() }),
  rich_text: z.object({ heading: opt(120), body: line(8000, "Write some text") }),
  stats: z.object({ items: z.array(z.object({ value: line(20), label: line(40) })).min(1, "Add at least one number").max(6, "Six numbers at most") }),
  gallery: z.object({ heading: opt(120), images: z.array(z.object({ url: imageSrc, caption: opt(120) })).min(1, "Add at least one photo").max(12, "Twelve photos at most") }),
  news: z.object({ heading: line(80), limit: z.coerce.number().int().min(1).max(12).default(4) }),
  events: z.object({ heading: line(80), limit: z.coerce.number().int().min(1).max(12).default(4) }),
  staff: z.object({ heading: line(80), limit: z.coerce.number().int().min(1).max(24).default(8) }),
  testimonials: z.object({ heading: opt(120), items: z.array(z.object({ name: line(80), role: opt(80), quote: line(400) })).min(1, "Add at least one quote").max(6, "Six quotes at most") }),
  admission_form: z.object({ heading: line(80), intro: opt(400), classes: z.array(line(40)).max(20) }),
  contact: z.object({ heading: opt(80), address: line(300, "Add the address"), phone: opt(30), email: z.string().trim().email("Enter a valid email").optional(), hours: opt(120) }),
  features: z.object({ heading: opt(120), intro: opt(300), items: z.array(z.object({ title: line(60), text: opt(240) })).min(1, "Add at least one point").max(12, "Twelve points at most") }),
  steps: z.object({ heading: opt(120), intro: opt(300), items: z.array(z.object({ title: line(60), text: opt(240) })).min(1, "Add at least one step").max(8, "Eight steps at most") }),
  image_text: z.object({ heading: opt(120), body: line(4000, "Write some text"), imageUrl: imageSrc.optional(), name: opt(80), role: opt(80), side: z.enum(["left", "right"]).default("right") }),
  faq: z.object({ heading: opt(120), items: z.array(z.object({ q: line(200), a: line(1000) })).min(1, "Add at least one question").max(20, "Twenty questions at most") }),
  table: z.object({ heading: opt(120), intro: opt(400), columns: z.array(line(40)).min(2, "Add at least two columns").max(6, "Six columns at most"), rows: z.array(z.array(z.string().trim().max(300)).max(6)).min(1, "Add at least one row").max(40, "Forty rows at most"), note: opt(300) }),
  links: z.object({ heading: opt(120), intro: opt(300), items: z.array(z.object({ label: line(80), href: link })).min(1, "Add at least one link").max(30, "Thirty links at most") }),
  cta: z.object({ heading: line(120, "Write a headline"), text: opt(300), ctaLabel: line(40, "Add the button text"), ctaHref: link }),
  video: z.object({ heading: opt(120), intro: opt(300), url: z.string().trim().regex(VIDEO_LINK, "Use a YouTube or Vimeo link").max(300), title: line(120, "Say what the video shows") }),
  documents: z.object({ heading: opt(120), intro: opt(300), items: z.array(z.object({ label: line(120, "Name the document"), url: fileSrc, group: opt(60), date: opt(10), size: z.coerce.number().int().min(0).optional() })).min(1, "Add at least one document").max(60, "Sixty documents at most") }),
  people: z.object({ heading: opt(120), intro: opt(300), items: z.array(z.object({ name: line(80), role: opt(80), text: opt(240), imageUrl: imageSrc.optional() })).min(1, "Add at least one person").max(40, "Forty people at most") }),
  achievers: z.object({ heading: opt(120), intro: opt(300), items: z.array(z.object({ name: line(80), result: line(80, "Add the result"), year: opt(20), imageUrl: imageSrc.optional() })).min(1, "Add at least one name").max(40, "Forty names at most") }),
  contact_form: z.object({ heading: line(80), intro: opt(400) }),
  disclosure: z.object({ heading: line(120).default("Mandatory public disclosure"), intro: opt(400), data: disclosureSchema, updatedOn: opt(10) }),
} satisfies Record<SectionType, z.ZodType>;

type Wrap<T extends SectionType> = { id: string; type: T; /** Kept in the draft and the published copy, not drawn. */ hidden?: boolean; /** Who last changed it and when. Draft only: stripped when published and from the public payload. */ by?: string; at?: string; data: z.infer<(typeof SECTION_DATA)[T]> };
export type Section = { [T in SectionType]: Wrap<T> }[SectionType];
export type SectionData<T extends SectionType> = z.infer<(typeof SECTION_DATA)[T]>;

const sid = z.string().min(1).max(40);
const sec = <T extends SectionType>(type: T) => z.object({ id: sid, type: z.literal(type), hidden: z.boolean().optional(), by: z.string().max(80).optional(), at: z.string().max(40).optional(), data: SECTION_DATA[type] });
export const sectionSchema = z.discriminatedUnion("type", [
  sec("hero"), sec("rich_text"), sec("stats"), sec("gallery"), sec("news"), sec("events"), sec("staff"), sec("testimonials"), sec("admission_form"), sec("contact"),
  sec("features"), sec("steps"), sec("image_text"), sec("faq"), sec("table"), sec("links"), sec("cta"),
  sec("video"), sec("documents"), sec("people"), sec("achievers"), sec("contact_form"), sec("disclosure"),
]);

export const pageSchema = z.object({
  slug: slugSchema,
  title: line(80, "Give the page a title"),
  /** One line under the title in the banner of an inner page. */
  intro: opt(200),
  seo: z.object({ title: opt(70), description: opt(200), imageUrl: imageSrc.optional() }).default({}),
  /** Not shown to visitors and not in the menu. */
  hidden: z.boolean().optional(),
  /** Visitors can open it; search engines are asked not to list it. */
  noindex: z.boolean().optional(),
  /** Who last changed the page itself (not its sections) and when. Draft only, like on a section. */
  by: z.string().max(80).optional(),
  at: z.string().max(40).optional(),
  sections: z.array(sectionSchema).max(30, "Thirty sections per page at most"),
});
export type Page = z.infer<typeof pageSchema>;

const navLeaf = z.object({ label: line(30), slug: slugSchema.optional(), href: link.optional() });
/** A menu item opens a page of the site (`slug`), a link (`href`), or only groups its children. */
export const navItemSchema = navLeaf.extend({ children: z.array(navLeaf).max(8, "Eight items under one menu entry at most").optional() });
export type NavItem = z.infer<typeof navItemSchema>;

export const siteContentSchema = z.object({
  pages: z.array(pageSchema).min(1).max(30),
  nav: z.array(navItemSchema).max(12),
  footer: z.object({
    text: opt(300), links: z.array(z.object({ label: line(40), href: link })).max(8),
    /** Titled lists of links, side by side above the footer line. Older sites have only `links`. */
    columns: z.array(z.object({ title: line(30), links: z.array(z.object({ label: line(40), href: link })).max(8) })).max(4, "Four columns at most").optional(),
  }).default({ links: [] }),
}).refine((c) => c.pages.some((p) => p.slug === HOME_SLUG), { message: "A site needs a home page", path: ["pages"] })
  .refine((c) => new Set(c.pages.map((p) => p.slug)).size === c.pages.length, { message: "Two pages share an address", path: ["pages"] });
export type SiteContent = z.infer<typeof siteContentSchema>;

// ---------- what each section type is called and starts as (its form fields are in ./editor) ----------

interface Meta { label: string; description: string; /** Starting data for a new section. */ initial: unknown }
const meta = <T extends SectionType>(label: string, description: string, initial: SectionData<T>): Meta => ({ label, description, initial });

export const SECTION_META: Record<SectionType, Meta> = {
  hero: meta<"hero">("Hero banner", "The big headline at the top of a page.",
    { heading: "Welcome to our school", subheading: "Write one friendly line about your school.", ctaLabel: "Apply for admission", ctaHref: "/admissions" }),
  rich_text: meta<"rich_text">("Text", "Headings, paragraphs and bullet points.",
    { heading: "About us", body: "Tell parents who you are and what makes your school different." }),
  stats: meta<"stats">("Numbers", "Up to six big numbers, like students or years.",
    { items: [{ value: "1,200", label: "Students" }, { value: "60", label: "Teachers" }, { value: "25", label: "Years" }] }),
  gallery: meta<"gallery">("Photo gallery", "A grid of your photos.",
    { heading: "Life at school", images: [{ url: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800", caption: "Sample photo. Replace with your own." }] }),
  news: meta<"news">("Latest news", "Your public announcements, newest first. Mark an announcement Public to show it here.", { heading: "News and notices", limit: 4 }),
  events: meta<"events">("Upcoming events", "Your public events. Mark an event Public to show it here.", { heading: "Upcoming events", limit: 4 }),
  staff: meta<"staff">("Our teachers", "Teachers with their subjects, from your staff list.", { heading: "Meet our teachers", limit: 8 }),
  testimonials: meta<"testimonials">("Parent voices", "Short quotes from parents or students.",
    { heading: "What parents say", items: [{ name: "A parent", role: "Class 5", quote: "My child looks forward to school every morning." }] }),
  admission_form: meta<"admission_form">("Admission enquiry form", "Parents fill it in; it lands in your Enquiries list.",
    { heading: "Admission enquiry", intro: "Tell us about your child and we will call you back within two working days.", classes: ["Nursery", "LKG", "UKG", "Class 1", "Class 2", "Class 3", "Class 4", "Class 5"] }),
  contact: meta<"contact">("Contact and map", "Address, phone, email and a Google map.", { heading: "Visit us", address: "Your school address" }),
  features: meta<"features">("Highlights", "A grid of short points, like facilities or reasons to choose you. The icon is picked from each title.",
    { heading: "Why families choose us", items: [
      { title: "Small classes", text: "Every teacher knows every child, so nobody is left behind." },
      { title: "Sports every day", text: "A games period for every class, with trained coaches." },
      { title: "Safe campus", text: "CCTV, verified staff and a guard at every gate." },
    ] }),
  steps: meta<"steps">("Steps", "A numbered process, like how to apply.",
    { heading: "How to apply", items: [
      { title: "Send an enquiry", text: "Fill in the short form or call the office." },
      { title: "Visit the school", text: "Meet the teachers and see the classrooms." },
      { title: "Submit documents", text: "Hand in the form with the documents listed below." },
      { title: "Confirm the seat", text: "Pay the admission fee to confirm." },
    ] }),
  image_text: meta<"image_text">("Photo with text", "A photo beside a few paragraphs. Good for the principal's message or your story.",
    { heading: "From the principal's desk", body: "Write a warm note to parents here. Say what your school stands for and what a child can expect on the first day.", role: "Principal", side: "right" }),
  faq: meta<"faq">("Questions and answers", "Common questions that open when clicked.",
    { heading: "Common questions", items: [{ q: "What are the school timings?", a: "Monday to Friday, 8 am to 2.30 pm. Saturday is a half day." }, { q: "Is there a school bus?", a: "Yes. Ask the office for the routes near you." }] }),
  table: meta<"table">("Table", "Rows and columns, like fees, timings or disclosure details.",
    { heading: "School timings", columns: ["Classes", "Monday to Friday", "Saturday"], rows: [["Nursery to UKG", "8.30 am to 12.30 pm", "Holiday"], ["Class 1 to 5", "8 am to 2 pm", "8 am to 12 noon"], ["Class 6 to 10", "8 am to 2.30 pm", "8 am to 12 noon"]] }),
  links: meta<"links">("Links and documents", "A list of links, like a prospectus, circulars or certificates.",
    { heading: "Downloads", items: [{ label: "Admission enquiry", href: "/admissions" }] }),
  video: meta<"video">("Video", "A YouTube or Vimeo video. It loads only when a visitor presses play.",
    { heading: "See our school", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", title: "A walk through the campus" }),
  documents: meta<"documents">("Documents", "Files to open or download, like a prospectus, circulars or transfer certificates.",
    { heading: "Documents", items: [{ label: "Add your first document", url: "https://example.org/document.pdf" }] }),
  people: meta<"people">("People", "Named people with a photo, like the management committee.",
    { heading: "Our leadership", items: [{ name: "Principal's name", role: "Principal" }] }),
  achievers: meta<"achievers">("Achievers", "Toppers and prize winners with their result.",
    { heading: "Our achievers", items: [{ name: "Student's name", result: "98.2% in Class 10", year: "2025-26" }] }),
  contact_form: meta<"contact_form">("Question form", "A short form for general questions. They land in Enquiries as questions.",
    { heading: "Ask us a question", intro: "Write to the school office and we will reply within two working days." }),
  disclosure: meta<"disclosure">("Public disclosure", "The mandatory disclosure in five parts. Fill it under Website, Disclosure.",
    { heading: "Mandatory public disclosure", data: { values: {} } }),
  cta: meta<"cta">("Call to action band", "A bold strip with one message and one button.",
    { heading: "Come and see the school", text: "Book a visit. We will show you around and answer every question.", ctaLabel: "Apply for admission", ctaHref: "/admissions" }),
};

// ---------- helpers for building pages ----------

export interface SchoolInfo { name: string; city?: string | null; address?: string | null; phone?: string | null; email?: string | null; board?: string | null }

export const newSectionId = (type: SectionType) => `${type.replace("_", "-")}-${crypto.randomUUID().slice(0, 6)}`;
/** A new section of a type with its data (schema defaults are filled in when the site is validated). */
export const mk = <T extends SectionType>(type: T, data: z.input<(typeof SECTION_DATA)[T]>) => ({ id: newSectionId(type), type, data }) as Section;
