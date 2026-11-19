// zod helpers for values that arrive from HTML forms (strings, missing checkboxes, empty selects). Use in every inputs.ts.
import { z } from "zod";

const empty = (v: unknown) => (v === "" || v === null ? undefined : v);

// Plain-language messages for every schema in the product (forms show these next to the field).
z.config({
  customError: (iss) => {
    if (iss.code === "invalid_type") return iss.input === undefined || iss.input === null ? "Required" : "Not a valid value";
    if (iss.code === "invalid_value") return "Choose one of the options";
    if (iss.code === "invalid_format") return iss.format === "uuid" ? "Choose one" : iss.format === "email" ? "Enter a valid email" : "Not a valid value";
    if (iss.code === "too_small" && iss.origin === "number") return `Must be at least ${iss.minimum}`;
    if (iss.code === "too_big" && iss.origin === "number") return `Must be at most ${iss.maximum}`;
    if (iss.code === "too_big" && iss.origin === "string") return `Keep it under ${iss.maximum} characters`;
    return undefined;
  },
});

export const f = {
  /** Checkbox: "true"/"on"/true → true; missing → false. */
  bool: () => z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean()),
  /** Required trimmed text. */
  text: (min = 1, max = 200, msg = "Required") => z.preprocess((v) => v ?? "", z.string().trim().min(min, msg).max(max)),
  /** Optional text: "" → undefined. */
  optText: (max = 500) => z.preprocess(empty, z.string().trim().max(max).optional()),
  /** Optional uuid from a select: "" → undefined. */
  optId: () => z.preprocess(empty, z.uuid().optional()),
  id: (msg = "Choose one") => z.uuid({ message: msg }),
  /** Whole number from a string. */
  int: (min = 0, max = 1_000_000) => z.coerce.number().int().min(min).max(max),
  optInt: (min = 0, max = 1_000_000) => z.preprocess(empty, z.coerce.number().int().min(min).max(max).optional()),
  /** Money as integer paise (FormModal converts rupees → paise before submit). */
  paise: (min = 0) => z.coerce.number().int().min(min, "Enter an amount"),
  /** "YYYY-MM-DD" date string. */
  date: (msg = "Pick a date") => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg),
  optDate: () => z.preprocess(empty, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  /** Indian mobile: 10 digits, optional +91. */
  phone: () => z.string().trim().regex(/^(\+91[\s-]?)?[6-9]\d{9}$/, "Enter a 10-digit mobile number"),
  optPhone: () => z.preprocess(empty, z.string().trim().regex(/^(\+91[\s-]?)?[6-9]\d{9}$/, "Enter a 10-digit mobile number").optional()),
  optEmail: () => z.preprocess(empty, z.email("Enter a valid email").optional()),
  /** Multi-select / repeated keys → string array. */
  list: () => z.preprocess((v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.string())),
};
