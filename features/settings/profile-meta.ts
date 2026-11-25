/** Facts about the school profile that are not database columns: states, GST codes, where each field is used, and how complete it is. */

/** GSTIN starts with the state's two-digit code. */
const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};
export const INDIAN_STATES = Object.values(GST_STATES).sort();

const plain = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z]+/g, " ").trim();
export const gstinState = (gstin: string | null | undefined) => (gstin ? GST_STATES[gstin.slice(0, 2)] ?? null : null);

export const SCHOOL_TYPES = ["Co-educational", "Boys", "Girls"];
export const MEDIUMS = ["English", "Hindi", "Bengali", "Marathi", "Gujarati", "Tamil", "Telugu", "Kannada", "Malayalam", "Urdu", "Other"];

export type ProfileGroup = "identity" | "contact" | "head" | "tax" | "calendar";
export const GROUP_LABELS: Record<ProfileGroup, string> = {
  identity: "Identity", contact: "Contact and address", head: "Head of school", tax: "Tax", calendar: "Calendar",
};

/** Where each detail shows up, so nobody wonders why it is asked. `needed` fields count toward completeness. */
export const PROFILE_FIELDS: { key: string; label: string; group: ProfileGroup; usedIn: string; needed?: boolean }[] = [
  { key: "name", label: "School name", group: "identity", needed: true, usedIn: "Receipts, report cards, the website, every email" },
  { key: "board", label: "Board", group: "identity", needed: true, usedIn: "Report cards, the disclosure page" },
  { key: "affiliationNo", label: "Affiliation number", group: "identity", needed: true, usedIn: "Report cards, the disclosure page, the website" },
  { key: "schoolCode", label: "School code", group: "identity", usedIn: "The disclosure page" },
  { key: "udiseCode", label: "UDISE+ code", group: "identity", needed: true, usedIn: "The disclosure page, transfer certificates" },
  { key: "schoolType", label: "Type", group: "identity", needed: true, usedIn: "The disclosure page" },
  { key: "medium", label: "Medium", group: "identity", needed: true, usedIn: "The disclosure page, the website" },
  { key: "establishedYear", label: "Established", group: "identity", needed: true, usedIn: "The website, the disclosure page" },
  { key: "address", label: "Address", group: "contact", needed: true, usedIn: "Receipts, report cards, the website contact page" },
  { key: "city", label: "City", group: "contact", needed: true, usedIn: "Receipts, the website" },
  { key: "district", label: "District", group: "contact", needed: true, usedIn: "The disclosure page" },
  { key: "state", label: "State", group: "contact", needed: true, usedIn: "Receipts, the GSTIN check" },
  { key: "pincode", label: "PIN code", group: "contact", needed: true, usedIn: "Receipts, the website contact page" },
  { key: "phone", label: "Phone", group: "contact", needed: true, usedIn: "The website, receipts, report cards" },
  { key: "email", label: "Email", group: "contact", needed: true, usedIn: "The website, receipts, replies to families" },
  { key: "website", label: "Website", group: "contact", usedIn: "Receipts, the disclosure page" },
  { key: "headName", label: "Head of school", group: "head", needed: true, usedIn: "Report cards, certificates, the disclosure page" },
  { key: "headQualification", label: "Qualification", group: "head", usedIn: "The disclosure page" },
  { key: "gstin", label: "GSTIN", group: "tax", usedIn: "Fee receipts and invoices, when the school is GST registered" },
  { key: "timezone", label: "Timezone", group: "calendar", usedIn: "Every date and time you see" },
  { key: "academicYearStartMonth", label: "Academic year starts", group: "calendar", usedIn: "New academic years, fee calendars" },
];

type Profile = Record<string, unknown>;

/** What is still empty, each with the group its form lives in. */
export function completeness(p: Profile) {
  const needed = PROFILE_FIELDS.filter((f) => f.needed);
  const missing = needed.filter((f) => p[f.key] === null || p[f.key] === undefined || p[f.key] === "");
  return { filled: needed.length - missing.length, total: needed.length, missing };
}

/** Things that look wrong but are allowed: shown beside the field, never block saving. */
export function profileWarnings(p: Profile): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  const g = gstinState(p.gstin as string | null);
  const state = p.state as string | null;
  if (p.gstin && !g) out.push({ field: "gstin", text: "The first two digits of this GSTIN are not a state code. Check it against your GST certificate." });
  else if (g && state && plain(g) !== plain(state)) out.push({ field: "gstin", text: `This GSTIN is registered in ${g}, but the school's state is ${state}. Check both.` });
  return out;
}
