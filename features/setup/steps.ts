// Pure data about the wizard's steps. No framework imports: the service and the pages share it.

export const STEP_KEYS = ["profile", "year", "classes", "subjects", "students", "staff", "website"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export interface StepMeta {
  key: StepKey;
  label: string;
  /** One line under the step title. */
  blurb: string;
  /** Steps 2 and 3 cannot be skipped: nothing else works without a year and classes. */
  required: boolean;
  /** The feature that must be on for this step to show (academics and settings are always on, setup requires them). */
  feature?: string;
}

export const STEPS: readonly StepMeta[] = [
  { key: "profile", label: "School profile", blurb: "Your name, board and address show on receipts, report cards and your website.", required: false },
  { key: "year", label: "Academic year", blurb: "Every class, fee and attendance record belongs to a year.", required: true },
  { key: "classes", label: "Classes and sections", blurb: "Pick the classes you run and how many sections each has.", required: true },
  { key: "subjects", label: "Subjects", blurb: "Choose what each stage of the school studies.", required: false },
  { key: "students", label: "Students", blurb: "Bring your students in from a spreadsheet, or add them later one by one.", required: false, feature: "students" },
  { key: "staff", label: "Teachers", blurb: "Invite teachers by email. They set their own password.", required: false, feature: "staff" },
  { key: "website", label: "Website", blurb: "Pick a look and put your school online.", required: false, feature: "website" },
];

export const stepHref = (key: StepKey) => `/app/setup/${key}`;
export const DONE_HREF = "/app/setup/done";

export const stepMeta = (key: StepKey): StepMeta => STEPS.find((s) => s.key === key)!;

/** The step after `key` among the steps that are available, or the review page. */
export function nextHref(key: StepKey, available: readonly StepKey[]): string {
  const rest = STEP_KEYS.slice(STEP_KEYS.indexOf(key) + 1).filter((k) => available.includes(k));
  return rest[0] ? stepHref(rest[0]) : DONE_HREF;
}

export function backHref(key: StepKey, available: readonly StepKey[]): string | null {
  const before = STEP_KEYS.slice(0, STEP_KEYS.indexOf(key)).filter((k) => available.includes(k));
  const prev = before[before.length - 1];
  return prev ? stepHref(prev) : null;
}
