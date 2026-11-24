// Plain JSON on purpose: the HTML preview (DocumentPaper) and the PDF renderer read the very same objects.

export type DocumentKind = "receipt" | "invoice" | "statement" | "certificate" | "payslip" | "voucher";
export type DocumentLayout = "a4" | "a5" | "two_up" | "thermal80";

/** Parts of a document a school can switch off. A missing key means shown. */
export type DocumentField = "logo" | "header" | "facts" | "table" | "totals" | "words" | "notes" | "terms" | "signature" | "qr" | "footer" | "watermark" | "marks";

export interface DocumentColumn {
  key: string;
  label: string;
  align: "left" | "right" | "center";
  show: boolean;
}

/** How a document looks. Set once per school and kind. */
export interface DocumentConfig {
  layout: DocumentLayout;
  /** "theme" colours the title and rules with the school's theme; "none" prints black only. */
  accent: "theme" | "none";
  /** Title line, for example "Fee receipt". */
  title: string;
  /** School name first, then address lines. */
  headerLines: string[];
  logoUrl?: string | null;
  columns: DocumentColumn[];
  terms?: string | null;
  footer?: string | null;
  signature?: { name: string; title: string; imageUrl?: string | null } | null;
  /** Faint text across the page, for example "DRAFT". */
  watermark?: string | null;
  /** One label per copy ("School copy", "Family copy"); two_up prints one per half. */
  copies?: string[];
  showFields?: Partial<Record<DocumentField, boolean>>;
}

/** What one document says. Money cells arrive already formatted, so both renderers print the same text. */
export interface DocumentData {
  /** [label, value] pairs: Receipt no, Date, Student, Class... */
  facts: [string, string][];
  rows: Record<string, string | number | null>[];
  /** [label, value, strong?] */
  totals: [string, string, boolean?][];
  amountWords?: string | null;
  notes: string[];
  /** Stamps such as "DUPLICATE" or "REVERSED". */
  marks: string[];
  /** Raw SVG markup of a QR code. */
  qrSvg?: string | null;
}
