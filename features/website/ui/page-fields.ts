import { PAGE_TEMPLATES, PAGE_TEMPLATE_KEYS } from "@smw/site-templates";
import type { Field } from "@smw/ui/shell/FormModal";

/** The "Page settings" form: words in the banner and in search results. Shared by the editor and Pages and menu. */
export const pageFields: Field[] = [
  { name: "title", label: "Page title", required: true, wide: true },
  { name: "intro", label: "Line under the title", hint: "Shown in the banner at the top of the page.", wide: true },
  { name: "seoTitle", label: "Search result title", hint: "Up to 70 characters. Leave empty to use the page title.", section: "Search engines", wide: true },
  { name: "seoDescription", label: "Search result description", type: "textarea", hint: "One or two sentences, up to 200 characters.", section: "Search engines" },
  { name: "seoImageUrl", label: "Share picture", hint: "Shown when the page is shared on WhatsApp or Facebook. Paste the address of a photo from Media.", section: "Search engines", wide: true },
];

/** "Add page": a ready-made start, a title and an address. */
export const addPageFields: Field[] = [
  { name: "template", label: "Start from", type: "select", required: true, wide: true,
    options: PAGE_TEMPLATE_KEYS.map((k) => ({ value: k, label: `${PAGE_TEMPLATES[k].name}: ${PAGE_TEMPLATES[k].description}` })) },
  { name: "title", label: "Page title", placeholder: "Fees and scholarships", hint: "Leave empty to use the template's title." },
  { name: "slug", label: "Web address", placeholder: "fees", hint: "Leave empty to use the template's address. Lowercase letters, numbers and dashes." },
];
