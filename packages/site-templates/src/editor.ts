/** What the panel editor shows for each section type: one entry per field of the section's data. Pure data, no React. */
import type { SectionType } from "./content";

export interface EditField {
  /** Key in the section's data. */
  name: string;
  label: string;
  /** "lines" is a string[] typed one per line; "list" is an array of objects; "rows" is the string[][] of a table. Default "text". */
  kind?: "text" | "textarea" | "number" | "email" | "select" | "image" | "lines" | "list" | "rows";
  required?: boolean; hint?: string; placeholder?: string;
  /** Half width on wide screens. */
  half?: boolean;
  options?: { value: string; label: string }[];
  /** list: the fields of one row, what a row is called, the most rows allowed. */
  item?: EditField[]; itemLabel?: string; max?: number;
  /** list: the image field of a row, so several photos can be uploaded in one go. */
  bulk?: string;
}

const heading: EditField = { name: "heading", label: "Heading" };
const intro: EditField = { name: "intro", label: "Line under the heading" };
const feed: EditField[] = [{ ...heading, required: true }, { name: "limit", label: "How many to show", kind: "number", half: true }];
const points = (itemLabel: string, max: number): EditField[] => [heading, intro, { name: "items", label: `${itemLabel[0]!.toUpperCase()}${itemLabel.slice(1)}s`, kind: "list", itemLabel, max, item: [
  { name: "title", label: "Title", required: true }, { name: "text", label: "Text", kind: "textarea" },
] }];

export const EDITOR_FIELDS: Record<SectionType, EditField[]> = {
  hero: [
    { name: "eyebrow", label: "Small line above the headline", placeholder: "CBSE school, Nursery to Class 10" },
    { name: "heading", label: "Headline", required: true },
    { name: "subheading", label: "Supporting line", kind: "textarea" },
    { name: "ctaLabel", label: "Button text", placeholder: "Apply for admission", half: true }, { name: "ctaHref", label: "Button link", placeholder: "/admissions", half: true },
    { name: "cta2Label", label: "Second button text", placeholder: "Book a visit", half: true }, { name: "cta2Href", label: "Second button link", placeholder: "/contact", half: true },
    { name: "imageUrl", label: "Photo", kind: "image", hint: "A wide photo of your campus or classrooms works best." },
  ],
  rich_text: [heading, { name: "body", label: "Text", kind: "textarea", required: true, hint: "Leave a blank line between paragraphs. Start a line with ## for a sub-heading, or with - for a bullet point." }],
  stats: [{ name: "items", label: "Numbers", kind: "list", itemLabel: "number", max: 6, item: [{ name: "value", label: "Number", placeholder: "1,200+", required: true, half: true }, { name: "label", label: "What it counts", placeholder: "Students", required: true, half: true }] }],
  gallery: [heading, { name: "images", label: "Photos", kind: "list", itemLabel: "photo", max: 12, bulk: "url", item: [{ name: "url", label: "Photo", kind: "image", required: true }, { name: "caption", label: "Caption" }] }],
  news: feed, events: feed, staff: feed,
  testimonials: [heading, { name: "items", label: "Quotes", kind: "list", itemLabel: "quote", max: 6, item: [
    { name: "quote", label: "What they said", kind: "textarea", required: true }, { name: "name", label: "Name", required: true, half: true }, { name: "role", label: "Who they are", placeholder: "Parent of Class 4 student", half: true },
  ] }],
  admission_form: [{ ...heading, required: true }, { name: "intro", label: "Short note", kind: "textarea" }, { name: "classes", label: "Classes offered", kind: "lines", hint: "One per line, like Nursery or Class 1. Leave empty to let parents type it." }],
  contact: [heading, { name: "address", label: "Address", kind: "textarea", required: true, hint: "The map is drawn from this address." },
    { name: "phone", label: "Phone", half: true }, { name: "email", label: "Email", kind: "email", half: true }, { name: "hours", label: "Office hours", placeholder: "Monday to Saturday, 8 am to 3 pm" }],
  features: points("point", 12),
  steps: points("step", 8),
  image_text: [heading, { name: "body", label: "Text", kind: "textarea", required: true, hint: "Leave a blank line between paragraphs." },
    { name: "imageUrl", label: "Photo", kind: "image", hint: "Leave empty to show the text alone." },
    { name: "side", label: "Photo side", kind: "select", half: true, options: [{ value: "right", label: "Right" }, { value: "left", label: "Left" }] },
    { name: "name", label: "Signed by", placeholder: "Dr. Asha Menon", half: true }, { name: "role", label: "Their role", placeholder: "Principal", half: true }],
  faq: [heading, { name: "items", label: "Questions", kind: "list", itemLabel: "question", max: 20, item: [{ name: "q", label: "Question", required: true }, { name: "a", label: "Answer", kind: "textarea", required: true }] }],
  table: [heading, intro, { name: "columns", label: "Column titles", kind: "lines", required: true, hint: "One per line, two to six columns." },
    { name: "rows", label: "Rows", kind: "rows", hint: "A cell that holds a link (https://... or /page) becomes a View button." }, { name: "note", label: "Note under the table" }],
  links: [heading, intro, { name: "items", label: "Links", kind: "list", itemLabel: "link", max: 30, item: [{ name: "label", label: "Name", required: true, half: true }, { name: "href", label: "Link", placeholder: "https://... or /page", required: true, half: true }] }],
  cta: [{ name: "heading", label: "Headline", required: true }, { name: "text", label: "Supporting line", kind: "textarea" },
    { name: "ctaLabel", label: "Button text", required: true, half: true }, { name: "ctaHref", label: "Button link", placeholder: "/admissions", required: true, half: true }],
};
